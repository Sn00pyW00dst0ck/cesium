/*global define*/
define([
        '../Core/destroyObject',
        '../Core/Ellipsoid',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Math',
        '../Core/Matrix4',
        './CameraEventHandler',
        './CameraEventType',
        './CameraSpindleController',
        './CameraFreeLookController',
        './CameraHelpers',
        './AnimationCollection',
        '../ThirdParty/Tween'
    ], function(
        destroyObject,
        Ellipsoid,
        Cartesian3,
        Cartesian4,
        CesiumMath,
        Matrix4,
        CameraEventHandler,
        CameraEventType,
        CameraSpindleController,
        CameraFreeLookController,
        CameraHelpers,
        AnimationCollection,
        Tween) {
    "use strict";

    var maintainInertia = CameraHelpers.maintainInertia;

    /**
     * DOC_TBD
     * @alias CameraColumbusViewController
     * @constructor
     */
    var CameraColumbusViewController = function(canvas, camera, ellipsoid) {
        this._canvas = canvas;
        this._camera = camera;
        this._ellipsoid = ellipsoid || Ellipsoid.WGS84;

        /**
         * A parameter in the range <code>[0, 1]</code> used to determine how long
         * the camera will continue to translate because of inertia.
         * With a value of zero, the camera will have no inertia.
         *
         * @type Number
         */
        this.inertiaTranslate = 0.9;

        this._translateHandler = new CameraEventHandler(canvas, CameraEventType.LEFT_DRAG);

        this._spindleController = new CameraSpindleController(canvas, camera, Ellipsoid.UNIT_SPHERE);

        // TODO: Shouldn't change private variables like this, need to be able to change event modifiers
        //       on controllers.
        this._spindleController._spinHandler = this._spindleController._spinHandler && this._spindleController._spinHandler.destroy();
        this._spindleController._spinHandler = new CameraEventHandler(canvas, CameraEventType.MIDDLE_DRAG);
        this._spindleController.constrainedAxis = Cartesian3.UNIT_Z;

        this._transform = this._camera.transform.clone();
        this._lastInertiaTranslateMovement = undefined;

        this._animationCollection = new AnimationCollection();
        this._translateAnimation = undefined;

        this._mapWidth = this._ellipsoid.getRadii().x * Math.PI;
        this._mapHeight = this._ellipsoid.getRadii().y * CesiumMath.PI_OVER_TWO;
    };

    /**
     * @private
     */
    CameraColumbusViewController.prototype.update = function() {
        var translate = this._translateHandler;
        var translating = translate.isMoving() && translate.getMovement();

        if (translate.isButtonDown() || this._spindleController._zoomHandler.isButtonDown() || this._spindleController._spinHandler.isButtonDown()) {
            this._animationCollection.removeAll();
        }

        if (translating) {
            this._translate(translate.getMovement());
        }

        if (!translating && this.inertiaTranslate < 1.0) {
            maintainInertia(translate, this.inertiaTranslate, this._translate, this, '_lastInertiaTranslateMovement');
        }

        this._spindleController.update();

        this._correctPosition();
        this._animationCollection.update();

        return true;
    };

    CameraColumbusViewController.prototype._addCorrectTranslateAnimation = function(position, center, maxX, maxY) {
        var newPosition = position.clone();

        if (center.y > maxX) {
            newPosition.y -= center.y - maxX;
        } else if (center.y < -maxX) {
            newPosition.y += -maxX - center.y;
        }

        if (center.z > maxY) {
            newPosition.z -= center.z - maxY;
        } else if (center.z < -maxY) {
            newPosition.z += -maxY - center.z;
        }

        var camera = this._camera;
        var updateCV = function(value) {
            var interp = position.lerp(newPosition, value.time);
            var pos = new Cartesian4(interp.x, interp.y, interp.z, 1.0);
            camera.position = camera.getInverseTransform().multiplyWithVector(pos).getXYZ();
        };

        this._translateAnimation = this._animationCollection.add({
            easingFunction : Tween.Easing.Exponential.EaseOut,
            startValue : {
                time : 0.0
            },
            stopValue : {
                time : 1.0
            },
            onUpdate : updateCV
        });
    };

    CameraColumbusViewController.prototype._translate = function(movement) {
        var camera = this._camera;

        var startRay = camera.getPickRay(movement.startPosition);
        var endRay = camera.getPickRay(movement.endPosition);

        var position = new Cartesian4(startRay.origin.x, startRay.origin.y, startRay.origin.z, 1.0);
        position = camera.getInverseTransform().multiplyWithVector(position).getXYZ();
        var direction = new Cartesian4(startRay.direction.x, startRay.direction.y, startRay.direction.z, 0.0);
        direction = camera.getInverseTransform().multiplyWithVector(direction).getXYZ();
        var scalar = -position.z / direction.z;
        var startPlanePos = position.add(direction.multiplyWithScalar(scalar));

        position = new Cartesian4(endRay.origin.x, endRay.origin.y, endRay.origin.z, 1.0);
        position = camera.getInverseTransform().multiplyWithVector(position).getXYZ();
        direction = new Cartesian4(endRay.direction.x, endRay.direction.y, endRay.direction.z, 0.0);
        direction = camera.getInverseTransform().multiplyWithVector(direction).getXYZ();
        scalar = -position.z / direction.z;
        var endPlanePos = position.add(direction.multiplyWithScalar(scalar));

        var diff = startPlanePos.subtract(endPlanePos);
        camera.position = camera.position.add(diff);
    };

    CameraColumbusViewController.prototype._correctPosition = function()
    {
        var camera = this._camera;
        var position = camera.position;
        var direction = camera.direction;

        var scalar = -position.z / direction.z;
        var center = position.add(direction.multiplyWithScalar(scalar));
        center = new Cartesian4(center.x, center.y, center.z, 1.0);
        var centerWC = camera.transform.multiplyWithVector(center);
        this._transform.setColumn3(centerWC);

        var cameraPosition = new Cartesian4(camera.position.x, camera.position.y, camera.position.z, 1.0);
        var positionWC = camera.transform.multiplyWithVector(cameraPosition);
        camera.transform = this._transform.clone();

        var tanPhi = Math.tan(this._camera.frustum.fovy * 0.5);
        var tanTheta = this._camera.frustum.aspectRatio * tanPhi;
        var distToC = positionWC.subtract(centerWC).magnitude();
        var dWidth = tanTheta * distToC;
        var dHeight = tanPhi * distToC;

        var maxX = Math.max(dWidth - this._mapWidth, this._mapWidth);
        var maxY = Math.max(dHeight - this._mapHeight, this._mapHeight);

        if (positionWC.x < -maxX || positionWC.x > maxX || positionWC.y < -maxY || positionWC.y > maxY) {
            if (!this._translateHandler.isButtonDown()) {
                var animations = Tween.getAll();

                var translateX = centerWC.y < -maxX || centerWC.y > maxX;
                var translateY = centerWC.z < -maxY || centerWC.z > maxY;
                if ((translateX || translateY) && !this._lastInertiaTranslateMovement) {
                    if (animations.indexOf(this._translateAnimation) === -1) {
                        this._animationCollection.removeAll();
                    }
                    this._addCorrectTranslateAnimation(positionWC.getXYZ(), centerWC.getXYZ(), maxX, maxY);
                }
            }

            maxX = maxX + this._mapWidth * 0.5;
            if (centerWC.y > maxX) {
                positionWC.y -= centerWC.y - maxX;
            } else if (centerWC.y < -maxX) {
                positionWC.y += -maxX - centerWC.y;
            }

            maxY = maxY + this._mapHeight * 0.5;
            if (centerWC.z > maxY) {
                positionWC.z -= centerWC.z - maxY;
            } else if (centerWC.z < -maxY) {
                positionWC.z += -maxY - centerWC.z;
            }
        }

        camera.position = camera.getInverseTransform().multiplyWithVector(positionWC).getXYZ();
    };

    /**
      * Returns true if this object was destroyed; otherwise, false.
      * <br /><br />
      * If this object was destroyed, it should not be used; calling any function other than
      * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
      *
      * @memberof CameraColumbusViewController
      *
      * @return {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
      *
      * @see CameraSpindleController#destroy
      */
    CameraColumbusViewController.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Removes mouse listeners held by this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof CameraColumbusViewController
     *
     * @return {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see CameraColumbusViewController#isDestroyed
     *
     * @example
     * controller = controller && controller.destroy();
     */
    CameraColumbusViewController.prototype.destroy = function() {
        this._translateHandler = this._translateHandler && this._translateHandler.destroy();
        this._spindleController = this._spindleController && this._spindleController.destroy();
        return destroyObject(this);
    };

    return CameraColumbusViewController;
});