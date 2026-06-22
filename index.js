const https = require('https');
const _baseURL = 'https://www.link-tap.com/api/';
const RATE_LIMIT_MS = 15000; // LinkTap API enforces a minimum 15s interval between calls
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

  if (!that.config.taps || !Array.isArray(that.config.taps)) {
    that.log.warn("No 'taps' array found in config - check your LinkTap configuration");
    callback(that.accessories);
    return;
  }

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
  this.autoBack = tap.autoBack !== undefined ? tap.autoBack : true; //required, defaults to true

  this._lastApiCall = 0;        // timestamp (ms) of the last API call, for rate limiting
  this._pendingOffTimer = null; // holds a deferred off command when rate-limited

  this.log("Found LinkTap: %s [%s]", this.name, this.taplinkerId);

  this._service = this.getTapService();
};

LinkTapAccessory.prototype.getServices = function() {
  var informationService = new Service.AccessoryInformation();
  informationService
    .setCharacteristic(Characteristic.Manufacturer, "LinkTap")
    .setCharacteristic(Characteristic.Model, "LinkTap Wireless Water Timer")
    .setCharacteristic(Characteristic.SerialNumber, this.taplinkerId);
  this.informationService = informationService;

  return [informationService, this._service];
};

LinkTapAccessory.prototype.getTapService = function() {
  var tapService = new Service.Switch(this.name);
  tapService.getCharacteristic(Characteristic.On).on('set', this.turnOnTheTap.bind(this));

  /**
   * DurationTimer Characteristic
   **/
  class DurationTimer extends Characteristic {
    constructor() {
      super('Duration Timer', 'CDC6551D-2D1B-4CC1-A5AE-0200844A7BC3');
      this.setProps({
        format: 'int',
        unit: 's',
        perms: ['pr', 'pw'],
        minValue: 60,
        maxValue: 86340,
      });
      this.value = this.getDefaultValue();
    }
  }
  DurationTimer.UUID = 'CDC6551D-2D1B-4CC1-A5AE-0200844A7BC3';
  Characteristic.DurationTimer = DurationTimer;

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
  debug("Request for taplinker %s (gateway %s)", this.taplinkerId, gatewayId);

  // Any new command supersedes a deferred off that may be queued
  if (this._pendingOffTimer) {
    clearTimeout(this._pendingOffTimer);
    this._pendingOffTimer = null;
  }

  this._resetTimer();

  if (on) {
    this._sendInstantMode(true, callback);
    this._startTimer();
  } else {
    // Turning off: send a real stop command, respecting the 15s API rate limit
    var elapsed = Date.now() - this._lastApiCall;
    if (elapsed >= RATE_LIMIT_MS) {
      this._sendInstantMode(false, callback);
    } else {
      // Too soon since the last call - acknowledge HomeKit now and defer the API call
      var wait = RATE_LIMIT_MS - elapsed;
      this.log("Off command deferred %dms to respect LinkTap's 15s rate limit", wait);
      this._pendingOffTimer = setTimeout(function() {
        this._pendingOffTimer = null;
        this._sendInstantMode(false, null);
      }.bind(this), wait);
      callback();
    }
  }
};

// Shared helper that sends an activateInstantMode request (on or off)
LinkTapAccessory.prototype._sendInstantMode = function(on, callback) {
  var self = this;
  var data = {
    username: username,
    apiKey: apiKey,
    gatewayId: gatewayId,
    taplinkerId: this.taplinkerId,
    action: on,
    duration: on ? this.duration : 0,
    autoBack: this.autoBack
  };

  var body = JSON.stringify(data);
  debug("body", body);
  this._lastApiCall = Date.now();

  var req = https.request(_baseURL + "activateInstantMode", {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, function(res) {
    var responseBody = '';
    res.on('data', function(chunk) { responseBody += chunk; });
    res.on('end', function() {
      debug('STATUS: ', res.statusCode, responseBody);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (callback) callback();
      } else {
        var err = new Error("LinkTap API returned HTTP " + res.statusCode);
        self.log.error(err.message);
        if (callback) callback(err);
      }
    });
  });

  req.on('error', function(error) {
    self.log.error("LinkTap API request failed: %s", error.message);
    if (callback) callback(error);
  });

  req.write(body);
  req.end();
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
  this.log("Switching off the tap %s", this.name);
  // With autoBack enabled the LinkTap device stops watering on its own when the
  // duration elapses, so we only need to reflect that state back in HomeKit here.
  this._service.getCharacteristic(Characteristic.On).updateValue(false);
  this._timer = 0;
};

LinkTapAccessory.prototype._getDurationTimerValue = function(callback) {
  this.log("Returning current tap duration value: " + this._durationInSeconds / 60 + " minutes");
  callback(this._durationInSeconds);
};

LinkTapAccessory.prototype._setDurationTimerValue = function(value, callback) {
  this.log("Setting the Tap duration to: " + value / 60 + " minutes");
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
