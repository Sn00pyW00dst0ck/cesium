import Check from "../Core/Check.js";
import DeveloperError from "../Core/DeveloperError.js";
import defined from "../Core/defined.js";
import getJsonFromTypedArray from "../Core/getJsonFromTypedArray.js";
import MetadataTable from "./MetadataTable.js";

/**
 * An object representing voxel content for a {@link Cesium3DTilesVoxelProvider}.
 *
 * @alias VoxelContent
 * @constructor
 *
 * @param {Resource} resource The resource for this voxel content. This is used for fetching external buffers as needed.
 * @param {object} [json] Voxel JSON contents. Mutually exclusive with binary.
 * @param {Uint8Array} [binary] Voxel binary contents. Mutually exclusive with json.
 * @param {MetadataSchema} metadataSchema The metadata schema used by property tables in the voxel content
 *
 * @exception {DeveloperError} One of json and binary must be defined.
 *
 * @private
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 */
function VoxelContent(resource, json, binary, metadataSchema) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("resource", resource);
  if (defined(json) === defined(binary)) {
    throw new DeveloperError("One of json and binary must be defined.");
  }
  //>>includeEnd('debug');

  this._resource = resource;
  this._metadataTable = undefined;

  let chunks;
  if (defined(json)) {
    chunks = {
      json: json,
      binary: undefined,
    };
  } else {
    chunks = parseVoxelChunks(binary);
  }

  this._readyPromise = initialize(
    this,
    chunks.json,
    chunks.binary,
    metadataSchema
  );
}

Object.defineProperties(VoxelContent.prototype, {
  /**
   * A promise that resolves once all buffers are loaded.
   *
   * @type {Promise}
   * @readonly
   * @private
   */
  readyPromise: {
    get: function () {
      return this._readyPromise;
    },
  },

  /**
   * The {@link MetadataTable} storing voxel property values.
   *
   * @type {MetadataTable}
   * @readonly
   * @private
   */
  metadataTable: {
    get: function () {
      return this._metadataTable;
    },
  },
});

function initialize(content, json, binary, metadataSchema) {
  return requestBuffers(content, json, binary).then(function (buffersU8) {
    const bufferViewsU8 = {};
    const bufferViewsLength = json.bufferViews.length;
    for (let i = 0; i < bufferViewsLength; ++i) {
      const bufferViewJson = json.bufferViews[i];
      const start = bufferViewJson.byteOffset;
      const end = start + bufferViewJson.byteLength;
      const buffer = buffersU8[bufferViewJson.buffer];
      const bufferView = buffer.subarray(start, end);
      bufferViewsU8[i] = bufferView;
    }

    const propertyTableIndex = json.voxelTable;
    const propertyTableJson = json.propertyTables[propertyTableIndex];
    content._metadataTable = new MetadataTable({
      count: propertyTableJson.count,
      properties: propertyTableJson.properties,
      class: metadataSchema.classes[propertyTableJson.class],
      bufferViews: bufferViewsU8,
    });
    return content;
  });
}

function requestBuffers(content, json, binary) {
  const buffersLength = json.buffers.length;
  const bufferPromises = new Array(buffersLength);
  for (let i = 0; i < buffersLength; i++) {
    const buffer = json.buffers[i];
    if (defined(buffer.uri)) {
      const baseResource = content._resource;
      const bufferResource = baseResource.getDerivedResource({
        url: buffer.uri,
      });
      bufferPromises[i] = bufferResource
        .fetchArrayBuffer()
        .then(function (arrayBuffer) {
          return new Uint8Array(arrayBuffer);
        });
    } else {
      bufferPromises[i] = Promise.resolve(binary);
    }
  }

  return Promise.all(bufferPromises);
}

/**
 * A helper object for storing the two parts of the binary voxel content
 *
 * @typedef {object} VoxelChunks
 * @property {object} json The json chunk of the binary voxel content
 * @property {Uint8Array} binary The binary chunk of the binary voxel content. This represents the internal buffer.
 * @private
 */

/**
 * Given binary voxel content, split into JSON and binary chunks
 *
 * @param {Uint8Array} binaryView The binary voxel content
 * @returns {VoxelChunks} An object containing the JSON and binary chunks
 * @private
 */
function parseVoxelChunks(binaryView) {
  // Parse the header
  const littleEndian = true;
  const reader = new DataView(binaryView.buffer, binaryView.byteOffset);
  // Skip to the chunk lengths
  let byteOffset = 8;

  // Read the bottom 32 bits of the 64-bit byte length. This is ok for now because:
  // 1) not all browsers have native 64-bit operations
  // 2) the data is well under 4GB
  const jsonByteLength = reader.getUint32(byteOffset, littleEndian);
  byteOffset += 8;
  const binaryByteLength = reader.getUint32(byteOffset, littleEndian);
  byteOffset += 8;

  const json = getJsonFromTypedArray(binaryView, byteOffset, jsonByteLength);
  byteOffset += jsonByteLength;
  const binary = binaryView.subarray(byteOffset, byteOffset + binaryByteLength);

  return {
    json: json,
    binary: binary,
  };
}

export default VoxelContent;
