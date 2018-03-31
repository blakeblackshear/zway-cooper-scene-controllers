  /* global global, zway */

/*** Cooper Scene Controllers ZAutomation module ****************************************

Version: 1.0.0
(c) Blake Blackshear, 2018

-------------------------------------------------------------------------------
Author: Blake Blackshear
Description:
    Sync Cooper Scene Controller button status with indicators 

******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function CooperSceneControllers (id, controller) {
    // Call superconstructor first (BaseModule)
    CooperSceneControllers.super_.call(this, id, controller);
}

inherits(CooperSceneControllers, BaseModule);

//Static declations
_module = CooperSceneControllers;
CooperSceneControllers.binderMethods;
// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

CooperSceneControllers.prototype.init = function (config) {
    CooperSceneControllers.super_.prototype.init.call(this, config);

    var self = this;

    self.indicatorBindings = {};
    self.binderMethods = [];
    self.cooperControllers = {};

    self.log("CooperSceneControllers: init");

    //The boot sequence of ZWay is not well defined.
    //This method is used to detect device creation on boot and check any device on the list
    this.deviceCreated = function (device) {
	    if(self.isCooperController(device)) { self.fixCooperDevice(device); }
    };
    this.deviceDeleted = function (device) {
        if(self.isCooperController(device)) { self.unfixCooperDevice(device); }
    };

    self.deviceCreatedCallback = _.bind(self.deviceCreated, self);
    self.deviceDeletedCallback = _.bind(self.deviceDeleted, self);
    //Register for events
    this.controller.devices.on('created', this.deviceCreatedCallback);
    this.controller.devices.on('removed', this.deviceDeletedCallback);

    //Check all listed devices on each start, this will handle restarts after boot
    this.controller.devices.each(this.deviceCreatedCallback);
};

CooperSceneControllers.prototype.stop = function () {
    //Unbind
    for (var i = 0; i < this.binderMethods.length; i++){
        this.controller.devices.off(this.binderMethods[i].event, this.binderMethods[i].func);
    }
    this.binderMethods = [];

    for (var nodeId in this.indicatorBindings){
        zway.devices[nodeId].Indicator.data.stat.unbind(this.indicatorBindings[nodeId]);
    }

    //Unregister for device creation
    this.controller.devices.off('created',this.deviceCreated);
    this.controller.devices.off('removed',this.deviceDeleted);
    CooperSceneControllers.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

CooperSceneControllers.prototype.fixCooperDevice = function(device) {
    var self = this;
    var nodeId = this.getDeviceIndex(device.id);
    if ( global.ZWave && !isNaN(nodeId) ) {
        var syncIndicator = function(device) {
            // when the event is tied to an actual button, set the indicator
            if (device.get("deviceType") === "toggleButton"){
                var buttonNum = self.getButtonNum("zway", device.id);
                self.setIndicator(nodeId, buttonNum, device.get("metrics:level"));
                // fetch the values for any associated lights
                _.delay(_.bind(self.queryAssociatedDevices, self), 2000, nodeId, buttonNum);
            // else if the event is the generic off message, update the indicator
            } else if(device.get("deviceType") === "switchControl"){
                zway.devices[nodeId].Indicator.Get();
            }
        }
        this.controller.devices.on(device.id + ":change:metrics:level", syncIndicator);
        this.binderMethods.push({ event: device.id + ":change:metrics:level", func: syncIndicator});

        var updateButtonsCallback = function() {
            //self.log(JSON.stringify(this));
            var updateTime = zway.devices[nodeId].Indicator.data.stat.updateTime;
            var invalidateTime = zway.devices[nodeId].Indicator.data.stat.invalidateTime;
            if(updateTime > invalidateTime && updateTime > self.cooperControllers[nodeId].indicatorUpdateTime){
                self.cooperControllers[nodeId].indicatorUpdateTime = updateTime;
                self.updateButtons(nodeId, zway.devices[nodeId].Indicator.data.stat.value);
            }
        };

        var syncButtonsToDevices = function(device) {
            var nodeId = self.getDeviceIndex(device.id);
            // self.log("Sync triggered: "+nodeId);
            // loop over all controllers
            for (var controllerId in self.cooperControllers) {
                // self.log("Checking controller: "+controllerId);
                // loop over all association groups
                for (var groupId in self.cooperControllers[controllerId].associations) {
                    // self.log("Checking button: "+groupId);
                    // if the node id of the device is in the list
                    // self.log(JSON.stringify(self.cooperControllers[controllerId].associations[groupId]));
                    if (_.contains(self.cooperControllers[controllerId].associations[groupId], parseInt(nodeId))) {
                        // find the first node in the list that is on
                        var firstNodeOn = _.find(self.cooperControllers[controllerId].associations[groupId], function(associatedNodeId){
                            return zway.devices[associatedNodeId].instances[0].commandClasses[38].data.level.value > 0;
                        });

                        // fetch the virtual device for the associated button
                        var vDevId = self.getVDevId("zway", controllerId, groupId);
                        var buttonDev = self.controller.devices.get(vDevId);
                        
                        // if no devices were on
                        if (_.isUndefined(firstNodeOn)) {
                            // self.log("No devices on");
                            // and if the button is not off
                            if(buttonDev && buttonDev.get("metrics:level") != "off"){
                                buttonDev.set("metrics:level", "off");
                            }
                        }
                        // else if at least 1 device was on
                        else {
                            // self.log("At least one device is on");
                            // and if the button is not already on
                            if(buttonDev && buttonDev.get("metrics:level") != "on"){
                                buttonDev.set("metrics:level", "on");
                            }
                        }
                    }
                }
            }
        };

        if(!(nodeId in self.cooperControllers)){
            var sceneController = {
                indicatorUpdateTime: 0,
                desiredIndicatorValue: zway.devices[nodeId].Indicator.data.stat.value,
                associations: {1: [], 2: [], 3: [], 4: [], 5: []}
            };

            for (var i = 1; i < 6; i++){
                var associations = _.without(zway.devices[nodeId].Association.data[i].nodes.value, 1);
                // bind to the change events for associated devices
                _.each(associations, function(associatedDeviceId){
                    var vDevId = "ZWayVDev_zway_" + associatedDeviceId + "-0-38";
                    self.controller.devices.on(vDevId + ":change:metrics:level", syncButtonsToDevices);
                });
                sceneController.associations[i] = associations;
            }

            self.cooperControllers[nodeId] = sceneController;
        }

        if(!(nodeId in self.indicatorBindings)){
            zway.devices[nodeId].Indicator.data.stat.bind(updateButtonsCallback);
            self.indicatorBindings[nodeId] = updateButtonsCallback;
            // Fetch indicator status on first discovery
            zway.devices[nodeId].Indicator.Get();
        }
    }
};

CooperSceneControllers.prototype.unfixCooperDevice = function(device) {

};

//Retrieve the index of the physical device. null if not found
CooperSceneControllers.prototype.getDeviceIndex = function(vdevid) {
    var str = vdevid;

	var res = str.split("_");
	if(res[0] != "ZWayVDev")
	    return null;
	return res[res.length-1].split("-")[0];
};

// Calculates the virtual device id for the button based on the node id
// Assumes Group1->Scene1, Group2->Scene2, ...
// ZWayVDev_zway_Remote_14-0-0-2-S
CooperSceneControllers.prototype.getVDevId = function(controllerName, nodeId, buttonNum) {
    var deviceData = [nodeId, "0", "0", buttonNum, "S"];
    return ["ZWayVDev", controllerName, "Remote", deviceData.join("-")].join("_");
};

// Calculates the button for the virtual device id
// Assumes Group1->Scene1, Group2->Scene2, ...
// ZWayVDev_zway_Remote_14-0-0-2-S
CooperSceneControllers.prototype.getButtonNum = function(controllerName, vDevId) {
    return new RegExp('ZWayVDev_zway_Remote_\\d+-0-0-(\\d)-S', 'g').exec(vDevId)[1];
};

// Turn off virtual button if indicator is off
CooperSceneControllers.prototype.updateButtons = function(nodeId, indicatorValue) {
    if(!(indicatorValue & 1)){
        var vDevId = this.getVDevId("zway", nodeId, "1");
        var buttonDev = this.controller.devices.get(vDevId);
        if(buttonDev && buttonDev.get("metrics:level") != "off"){
            buttonDev.set("metrics:level", "off");
        }
    }
    if(!(indicatorValue & 2)){
        var vDevId = this.getVDevId("zway", nodeId, "2");
        var buttonDev = this.controller.devices.get(vDevId);
        if(buttonDev && buttonDev.get("metrics:level") != "off"){
            buttonDev.set("metrics:level", "off");
        }
    }
    if(!(indicatorValue & 4)){
        var vDevId = this.getVDevId("zway", nodeId, "3");
        var buttonDev = this.controller.devices.get(vDevId);
        if(buttonDev && buttonDev.get("metrics:level") != "off"){
            buttonDev.set("metrics:level", "off");
        }
    }
    if(!(indicatorValue & 8)){
        var vDevId = this.getVDevId("zway", nodeId, "4");
        var buttonDev = this.controller.devices.get(vDevId);
        if(buttonDev && buttonDev.get("metrics:level") != "off"){
            buttonDev.set("metrics:level", "off");
        }
    }
    if(!(indicatorValue & 16)){
        var vDevId = this.getVDevId("zway", nodeId, "5");
        var buttonDev = this.controller.devices.get(vDevId);
        if(buttonDev && buttonDev.get("metrics:level") != "off"){
            buttonDev.set("metrics:level", "off");
        }
    }
};

CooperSceneControllers.prototype.setIndicator = function(nodeId, buttonNum, value) {
    var currentIndicatorValue = this.cooperControllers[nodeId].desiredIndicatorValue;

    var buttonBitwiseValues = {
        "1": 1,
        "2": 2,
        "3": 4,
        "4": 8,
        "5": 16
    };

    var buttonBitwise = buttonBitwiseValues[buttonNum];

    // if button is on and turning off
    if(currentIndicatorValue & buttonBitwise && value == "off"){
        currentIndicatorValue = currentIndicatorValue - buttonBitwise;
    }
    // else if button is off and turning on
    else if(!(currentIndicatorValue & buttonBitwise) && value == "on"){
        currentIndicatorValue = currentIndicatorValue + buttonBitwise;
    }

    this.cooperControllers[nodeId].desiredIndicatorValue = currentIndicatorValue;
    zway.devices[nodeId].Indicator.Set(currentIndicatorValue);
};

CooperSceneControllers.prototype.queryAssociatedDevices = function(nodeId, buttonNum) {
    var self = this

    var associations = self.cooperControllers[nodeId].associations[buttonNum];

    self.controller.devices.each(function(device) {
        var deviceIndex = self.getDeviceIndex(device.id);
        if(_.contains(associations, parseInt(deviceIndex))) {
            if(device.get('deviceType') === 'switchMultilevel') {
                zway.devices[deviceIndex].instances[0].commandClasses[38].Get();
            }
        }
    });
};

CooperSceneControllers.prototype.isCooperController = function(device) {
    var self = this;

    var vDevId = device.id;
    var nodeId = this.getDeviceIndex(vDevId);

    if(nodeId){
        var vendorName = "";
        if (zway.devices[nodeId].data.vendorString.value) {
            vendorName = zway.devices[nodeId].data.vendorString.value;
        }

        var deviceType = "";
        if (zway.devices[nodeId].data.deviceTypeString.value) {
            deviceType = zway.devices[nodeId].data.deviceTypeString.value;
        }

        if (vendorName == "Cooper" && deviceType == "Static Scene Controller"){
            self.log("Found Cooper Controller: " + nodeId);
            return true;
        }
    }

    return false;
};