const request = require('request');
const _baseURL = 'https://www.link-tap.com/api/';
var inherits = require('util').inherits;
var Service, Characteristic, Accessory, UUIDGen;
var debug = require('debug')('linktap');

var username, apiKey, gatewayId;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-platform-linktap", "LinkTapPlatform", LinkTapPlatform);
};

function LinkTapPlatform(log, config, api) {
  this.log = log;
  this.debug = log.debug;

  if (!config) {
    log.warn("Ignoring LinkTap Platform setup because it is not configured");
    this.disabled = true;
    return;
  }
  this.config = config;

  this.api = api;

  username = config.username || "default"; //required username
  apiKey = config.apiKey || "default"; //required apiKey generated from https://www.link-tap.com/#!/api-for-developers
  gatewayId = config.gatewayId || "default"; //required xxxx-xxxx-xxxx-xxxx (no hyphens)
};

LinkTapPlatform.prototype.accessories = function(callback) {
  var that = this;
  that.accessories = [];
  //tap is a config for each of the linktaps.
  that.config.taps.forEach(function(tap) {
    that.accessories.push(new LinkTapAccessory(that.log, tap));
  });
  callback(that.accessories);
};

function LinkTapAccessory(log, tap) {
  this.log = log;

  this.name = tap.name; //required friendly name
  this.location = tap.location; //optional fyi
  this.taplinkerId = tap.taplinkerId; //required xxxx-xxxx-xxxx-xxxx (no hyphens)
  this.duration = tap.duration; //required timer value in minutes 1..1439 minutes
  this._durationInSeconds = this.duration * 60;
  this.autoBack = tap.autoBack || true; //required

  this.log("Found LinkTap: %s [%s]", this.name, this.taplinkerId);

  this._service = this.getTapService();
};

LinkTapAccessory.prototype.getServices = function() {
  var informationService = new Service.AccessoryInformation();
  informationService
    .setCharacteristic(Characteristic.Manufacturer, "LinkTap")
    .setCharacteristic(Characteristic.Model, "LinkTap Wireless Water Timer")
    .setCharacteristic(Characteristic.SerialNumber, "12345");
  this.informationService = informationService;

  return [informationService, this._service];
};

LinkTapAccessory.prototype.getTapService = function() {
  var tapService = new Service.Switch(this.name);
  tapService.getCharacteristic(Characteristic.On).on('set', this.turnOnTheTap.bind(this));

  /**
   * DurationTimer Characteristic
   **/
  Characteristic.DurationTimer = function() {
    Characteristic.call(this, 'Duration Timer', 'CDC6551D-2D1B-4CC1-A5AE-0200844A7BC3');

    this.setProps({
      format: Characteristic.Formats.INT,
      unit: Characteristic.Units.SECONDS,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE],
      minValue: 60,
      maxValue: 86340,
    });

    this.value = this.getDefaultValue();
  };
  inherits(Characteristic.DurationTimer, Characteristic);
  Characteristic.DurationTimer.UUID = 'CDC6551D-2D1B-4CC1-A5AE-0200844A7BC3';

  tapService.addCharacteristic(Characteristic.DurationTimer);
  tapService.updateCharacteristic(Characteristic.DurationTimer, this._durationInSeconds);
  tapService.getCharacteristic(Characteristic.DurationTimer)
    .on('get', this._getDurationTimerValue.bind(this))
    .on('set', this._setDurationTimerValue.bind(this));

  return tapService;
};

LinkTapAccessory.prototype.identify = function(callback) {
  this.log("%s - Identify", this.name);
  callback();
};

LinkTapAccessory.prototype.turnOnTheTap = function(on, callback) {
  this.log("Setting tap state to " + on);
  this.log("Data: %s, %s, %s", username, apiKey, gatewayId, this.taplinkerId, this.duration);

  var data = {
    username: username,
    apiKey: apiKey,
    gatewayId: gatewayId,
    taplinkerId: this.taplinkerId,
    action: 'true',
    duration: this.duration,
    autoBack: this.autoBack
  };


  var body = JSON.stringify(data);
  debug("body",body);
  this._resetTimer();
  if (on) {

    request({
        url: _baseURL + "activateInstantMode",
        body: body,
        method: 'POST',
        headers: {
          'Content-type': 'application/json'
        }
      },
      function(error, response) {
        if (error) {
          debug(error);
          debug('STATUS: ', response.statusCode);
          callback(error);
        }  else {
          debug('STATUS: ', response.statusCode, response.body);
        }
      }.bind(this));
    this._startTimer();
  }
  callback();
};

LinkTapAccessory.prototype._startTimer = function() {
  var durationInMiliseconds = this._durationInSeconds * 1000;

  this.log("Starting timer for " + durationInMiliseconds + "ms");
  this._timer = setTimeout(this._onTimeout.bind(this), durationInMiliseconds);
};

LinkTapAccessory.prototype._resetTimer = function() {
  clearTimeout(this._timer);
  this._timer = 0;
};

LinkTapAccessory.prototype._onTimeout = function() {
  var that = this;
  that.log("Switching off the tap %s", this.name);
  /*request({
    	url: _baseURL + "activateInstantMode",
    	body: {
    		username: this.username,
			apiKey: this.apiKey,
			gatewayId: this.gatewayId,
			taplinkerId: this.taplinkerId,
			action: 'false',
			duration: 0
 		},
 		method: 'POST',
 		headers: {'Content-type': 'application/json'}
 	},
 	function (error, response) {
 		if (error) {
     		that.log('STATUS: ' + response.statusCode);
     		that.log(error.message);
     		callback(error);
   		}
    });*/
  this._service.getCharacteristic(Characteristic.On).updateValue(false, undefined, undefined);
  this._timer = 0;
};

LinkTapAccessory.prototype._getDurationTimerValue = function(callback) {
  this.log("Returning current tap duration value: " + this._durationInSeconds / 60 + "minutes");
  callback(this._durationInSeconds);
};

LinkTapAccessory.prototype._setDurationTimerValue = function(value, callback) {
  this.log("Setting the Tap duration to: " + value / 60 + "minutes");
  this._durationInSeconds = value;
  callback();
};

/**
 * Future work...
 * device.Status: Connected/Disconnected 	-> Characteristic.Active (https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L29)
 * device.BatteryLevel: 0..100%		-> Characteristic.BatteryLevel https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L159
 * ?device.InUse: Yes/No			-> Characteristic.InUse (https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L948)
 * ?Characteristic.SetupEndpoints
 * ?Characteristic.StatusActive
 * ?Characteristic.StatusLowBattery
 **/
