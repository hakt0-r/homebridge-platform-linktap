const https = require('https');
const _baseURL = 'https://www.link-tap.com/api/';
const RATE_LIMIT_MS = 15000;        // activateInstantMode: min 15s between calls
const MIN_POLL_MINUTES = 5;         // getAllDevices: manufacturer limits status polling to every 5 min
const DEFAULT_POLL_MINUTES = 5;
const LOW_BATTERY_THRESHOLD = 20;   // percent at or below which HomeKit shows a low-battery warning
var Service, Characteristic, Accessory, UUIDGen;
var debug = require('debug')('linktap');

var username, apiKey, gatewayId;

// Parse a battery/signal value that may arrive as a number (85) or a string ("85%")
function parsePercent(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Math.max(0, Math.min(100, Math.round(val)));
  var m = String(val).match(/(\d+(\.\d+)?)/);
  return m ? Math.max(0, Math.min(100, Math.round(parseFloat(m[1])))) : null;
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-platform-linktap-v2", "LinkTapPlatform", LinkTapPlatform);
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
  that.accessoryList = [];

  if (!that.config.taps || !Array.isArray(that.config.taps)) {
    that.log.warn("No 'taps' array found in config - check your LinkTap configuration");
    callback(that.accessoryList);
    return;
  }

  //tap is a config for each of the linktaps.
  that.config.taps.forEach(function(tap) {
    that.accessoryList.push(new LinkTapAccessory(that.log, tap));
  });
  callback(that.accessoryList);

  // Begin polling device status (battery + signal) once accessories are registered
  that._startPolling();
};

// Schedule periodic getAllDevices polling for battery and signal updates
LinkTapPlatform.prototype._startPolling = function() {
  var that = this;
  var minutes = this.config.pollInterval;

  if (minutes === 0) {
    this.log("Status polling disabled (pollInterval = 0); battery and signal will not update");
    return;
  }
  if (minutes === undefined || minutes === null) minutes = DEFAULT_POLL_MINUTES;
  if (minutes < MIN_POLL_MINUTES) {
    this.log.warn("pollInterval %d is below the API minimum of %d minutes; using %d",
      minutes, MIN_POLL_MINUTES, MIN_POLL_MINUTES);
    minutes = MIN_POLL_MINUTES;
  }

  var intervalMs = minutes * 60 * 1000;
  this.log("Polling LinkTap status every %d minute(s) for battery and signal", minutes);

  // First poll shortly after startup, then on the interval
  setTimeout(function() { that._pollStatus(); }, 10000);
  this._pollTimer = setInterval(function() { that._pollStatus(); }, intervalMs);
};

// Query getAllDevices and distribute battery/signal/online status to each accessory
LinkTapPlatform.prototype._pollStatus = function() {
  var that = this;
  var body = JSON.stringify({ username: username, apiKey: apiKey });

  var req = https.request(_baseURL + "getAllDevices", {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, function(res) {
    var responseBody = '';
    res.on('data', function(chunk) { responseBody += chunk; });
    res.on('end', function() {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        that.log.error("getAllDevices returned HTTP %d", res.statusCode);
        return;
      }
      try {
        var parsed = JSON.parse(responseBody);
        debug("getAllDevices response: %s", responseBody);
        that._applyStatus(parsed);
      } catch (e) {
        that.log.error("Failed to parse getAllDevices response: %s", e.message);
      }
    });
  });

  req.on('error', function(err) {
    that.log.error("getAllDevices request failed: %s", err.message);
  });

  req.write(body);
  req.end();
};

// Walk the getAllDevices response and push status into matching accessories.
// The response nests taplinkers under devices[].deviceList[]; field names can vary
// slightly by firmware, so matching and parsing here are deliberately defensive.
LinkTapPlatform.prototype._applyStatus = function(parsed) {
  var that = this;

  // TEMPORARY (v1.9.1): log the raw response at normal level so the device's
  // field names (workMode, pause state, alerts) can be confirmed without the
  // debug env var, which child-bridge processes don't always inherit.
  try {
    this.log("RAW getAllDevices: %s", JSON.stringify(parsed));
  } catch (e) {}

  var gateways = parsed.devices || parsed.deviceList || [];
  var taplinkers = [];

  gateways.forEach(function(gw) {
    var list = gw.deviceList || gw.devices || [];
    list.forEach(function(d) { taplinkers.push(d); });
  });

  if (taplinkers.length === 0) {
    debug("getAllDevices returned no taplinkers to match");
    return;
  }

  taplinkers.forEach(function(d) {
    var id = d.taplinkerId || d.deviceId || d.id;
    if (!id) return;

    var accessory = that.accessoryList.find(function(a) {
      return a.taplinkerId && a.taplinkerId.toUpperCase() === String(id).toUpperCase();
    });
    if (!accessory) return;

    var battery = parsePercent(d.batteryStatus !== undefined ? d.batteryStatus : d.battery);
    var signal = parsePercent(d.signal);
    var online;
    if (d.status !== undefined) {
      online = (d.status === true || d.status === 'Connected' || d.status === 'online');
    }

    // Live watering state for InUse. LinkTap reports this in the `watering` field,
    // which is null/absent when idle and populated while water is flowing. Only
    // override the local state when the field is actually present in the response.
    var watering;
    if (d.watering !== undefined) {
      watering = (d.watering !== null && d.watering !== false);
    }

    // Combined fault detection. LinkTap reports various alerts; exact field names
    // vary by firmware, so check a defensive set plus a generic alert flag/array.
    // Leaves fault undefined (no override) when none of these fields are present.
    var fault;
    var faultFlags = [
      d.noWater, d.waterCut, d.waterCutAlert,
      d.fall, d.fallStatus, d.fallen,
      d.valveBroken, d.shutdownFailure, d.broken,
      d.clog, d.lowFlow, d.leakage, d.abnormalFlow
    ];
    var anyFaultField = faultFlags.some(function(v) { return v !== undefined; });
    if (anyFaultField || d.alert !== undefined || d.alerts !== undefined) {
      fault = faultFlags.some(function(v) { return v === true || v === 1 || v === 'true'; });
      if (!fault && d.alert) fault = true;
      if (!fault && Array.isArray(d.alerts) && d.alerts.length > 0) fault = true;
    }

    // Pause state, so the Home app reflects pause/resume done in the LinkTap app.
    // Field name is unconfirmed across firmware; check the likely candidates and
    // leave undefined (no override) when none are present.
    var paused;
    if (d.watactivated !== undefined) {        // some firmwares: watactivated=false when paused
      paused = (d.watactivated === false);
    } else if (d.paused !== undefined) {
      paused = (d.paused === true || d.paused === 1);
    } else if (d.pause !== undefined) {
      paused = (d.pause === true || d.pause === 1 || (typeof d.pause === 'object' && d.pause !== null));
    }

    accessory.updateStatus(battery, signal, online, watering, fault, paused);
  });
};

function LinkTapAccessory(log, tap) {
  this.log = log;

  this.name = tap.name; //required friendly name
  this.location = tap.location; //optional fyi
  this.taplinkerId = tap.taplinkerId; //required xxxx-xxxx-xxxx-xxxx (no hyphens)
  this.duration = tap.duration; //required timer value in minutes 1..1439 minutes
  this._durationInSeconds = this.duration * 60;
  this.autoBack = tap.autoBack !== undefined ? tap.autoBack : true; //required, defaults to true
  this.pauseHours = tap.pauseHours !== undefined ? tap.pauseHours : 24; // finite default so the schedule auto-resumes; -1 = indefinite
  this.scheduleMode = tap.scheduleMode || 'sevenDay'; // which plan to re-activate on resume

  this._lastApiCall = 0;        // timestamp (ms) of the last API call, for rate limiting
  this._pendingOffTimer = null; // holds a deferred off command when rate-limited

  this._active = 0;             // Characteristic.Active: 0 = inactive, 1 = active (user intent)
  this._inUse = 0;              // Characteristic.InUse: 0 = not flowing, 1 = water flowing
  this._paused = 0;             // 0 = schedule running, 1 = watering plan paused

  // Status (updated by the platform's polling loop)
  this._batteryLevel = 100;
  this._statusLowBattery = 0;   // 0 = normal, 1 = low
  this._signal = 100;
  this._online = true;
  this._fault = 0;              // 0 = no fault, 1 = any LinkTap alert active

  this.log("Found LinkTap: %s [%s]", this.name, this.taplinkerId);

  this._service = this.getTapService();
  this._batteryService = this.getBatteryService();
  this._faultService = this.getFaultService();
  this._pauseService = this.getPauseService();
};

LinkTapAccessory.prototype.getServices = function() {
  var informationService = new Service.AccessoryInformation();
  informationService
    .setCharacteristic(Characteristic.Manufacturer, "LinkTap")
    .setCharacteristic(Characteristic.Model, "LinkTap Wireless Water Timer")
    .setCharacteristic(Characteristic.SerialNumber, this.taplinkerId);
  this.informationService = informationService;

  return [informationService, this._service, this._batteryService, this._faultService, this._pauseService];
};

LinkTapAccessory.prototype.getTapService = function() {
  // Modelled as an irrigation Valve so HomeKit shows Active (on/off) and InUse (watering)
  var tapService = new Service.Valve(this.name);

  tapService.getCharacteristic(Characteristic.Active)
    .on('set', this._setActive.bind(this))
    .on('get', function(cb) { cb(null, this._active); }.bind(this));

  tapService.getCharacteristic(Characteristic.InUse)
    .on('get', function(cb) { cb(null, this._inUse); }.bind(this));

  tapService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.IRRIGATION);

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

  // StatusFault reflects connection status: NO_FAULT when online, GENERAL_FAULT when offline
  tapService.addCharacteristic(Characteristic.StatusFault);
  tapService.getCharacteristic(Characteristic.StatusFault)
    .on('get', function(cb) { cb(null, this._online ? 0 : 1); }.bind(this));

  return tapService;
};

// Pause switch: pauses/resumes the device's scheduled watering plans.
// ON  -> pauseWateringPlan with the configured duration (default indefinite, -1)
// OFF -> resume (best-effort; mirrors the app's "Deactivate" pause action)
LinkTapAccessory.prototype.getPauseService = function() {
  var pauseService = new Service.Switch(this.name + " Pause Schedule");
  pauseService.getCharacteristic(Characteristic.On)
    .on('get', function(cb) { cb(null, this._paused === 1); }.bind(this))
    .on('set', this._setPause.bind(this));
  return pauseService;
};

// Combined fault sensor: a single LeakSensor tile that trips on ANY LinkTap alert
// (water cut, clog/abnormal flow, fallen device, valve shutdown failure, etc.).
// Modelled as a leak sensor so HomeKit raises a clear alert notification.
LinkTapAccessory.prototype.getFaultService = function() {
  var faultService = new Service.LeakSensor(this.name + " Alert");
  faultService.getCharacteristic(Characteristic.LeakDetected)
    .on('get', function(cb) { cb(null, this._fault); }.bind(this));
  return faultService;
};

// Battery service exposes battery level and a low-battery warning in HomeKit
LinkTapAccessory.prototype.getBatteryService = function() {
  var BatteryService = Service.Battery || Service.BatteryService;
  var batteryService = new BatteryService(this.name + " Battery");

  batteryService.getCharacteristic(Characteristic.BatteryLevel)
    .on('get', function(cb) { cb(null, this._batteryLevel); }.bind(this));

  batteryService.getCharacteristic(Characteristic.StatusLowBattery)
    .on('get', function(cb) { cb(null, this._statusLowBattery); }.bind(this));

  // LinkTap taplinkers run on replaceable batteries, so they are never "charging"
  batteryService.setCharacteristic(
    Characteristic.ChargingState,
    Characteristic.ChargingState.NOT_CHARGEABLE
  );

  return batteryService;
};

// Called by the platform poll loop with the latest status for this tap
LinkTapAccessory.prototype.updateStatus = function(batteryPct, signalPct, online, watering, fault, paused) {
  if (batteryPct !== null && batteryPct !== undefined) {
    this._batteryLevel = batteryPct;
    this._statusLowBattery = batteryPct <= LOW_BATTERY_THRESHOLD ? 1 : 0;
    if (this._batteryService) {
      this._batteryService.updateCharacteristic(Characteristic.BatteryLevel, this._batteryLevel);
      this._batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this._statusLowBattery);
    }
  }

  if (signalPct !== null && signalPct !== undefined) {
    this._signal = signalPct;
  }

  if (online !== null && online !== undefined) {
    this._online = online;
    if (this._service) {
      this._service.updateCharacteristic(Characteristic.StatusFault, online ? 0 : 1);
    }
  }

  // Independent flow sensing: reflect the device's real watering state in HomeKit.
  // This catches watering started or stopped outside HomeKit (LinkTap app, manual
  // button, schedules). Active mirrors InUse so the tile shows on/off correctly.
  if (watering !== null && watering !== undefined) {
    var newInUse = watering ? 1 : 0;
    if (newInUse !== this._inUse) {
      this._inUse = newInUse;
      this._active = newInUse;
      if (this._service) {
        this._service.updateCharacteristic(Characteristic.InUse, this._inUse);
        this._service.updateCharacteristic(Characteristic.Active, this._active);
      }
      // If watering stopped externally, clear any local auto-off timer
      if (!watering) this._resetTimer();
    }
  }

  if (fault !== null && fault !== undefined) {
    this._fault = fault ? 1 : 0;
    if (this._faultService) {
      this._faultService.updateCharacteristic(Characteristic.LeakDetected, this._fault);
    }
    if (this._fault) this.log.warn("%s reported an alert/fault condition", this.name);
  }

  // Reflect pause/resume performed outside HomeKit (e.g. in the LinkTap app)
  if (paused !== null && paused !== undefined) {
    var newPaused = paused ? 1 : 0;
    if (newPaused !== this._paused) {
      this._paused = newPaused;
      if (this._pauseService) {
        this._pauseService.updateCharacteristic(Characteristic.On, this._paused === 1);
      }
    }
  }

  this.log("%s status: battery %s%%, signal %s%%, %s%s%s",
    this.name, this._batteryLevel, this._signal,
    this._online ? "online" : "offline",
    (watering !== undefined ? (watering ? ", watering" : ", idle") : ""),
    (this._fault ? ", ALERT" : ""));
};

LinkTapAccessory.prototype.identify = function(callback) {
  this.log("%s - Identify", this.name);
  callback();
};

// Valve Active set handler. Maps Active (0/1) onto the watering logic and
// updates InUse to reflect whether water is flowing.
LinkTapAccessory.prototype._setActive = function(value, callback) {
  var on = (value === Characteristic.Active.ACTIVE || value === 1);
  this._active = on ? 1 : 0;
  this._inUse = on ? 1 : 0;

  if (this._service) {
    this._service.updateCharacteristic(Characteristic.InUse, this._inUse);
  }

  this.turnOnTheTap(on, callback);
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

// Pause switch handler: ON pauses the watering plan, OFF resumes it.
LinkTapAccessory.prototype._setPause = function(value, callback) {
  var pause = (value === true || value === 1);
  this._paused = pause ? 1 : 0;
  if (pause) {
    this._pauseWateringPlan(callback);
  } else {
    this._resumeWateringPlan(callback);
  }
};

// Map a configured schedule mode to its activate endpoint
var SCHEDULE_MODE_ENDPOINTS = {
  sevenDay: 'activateSevenDayMode',
  interval: 'activateIntervalMode',
  oddEven: 'activateOddEvenMode',
  month: 'activateMonthMode',
  calendar: 'activateCalendarMode'
};

// Pause the device's scheduled watering plans for a finite duration so the
// schedule auto-resumes even if an explicit resume is missed. pauseHours -1
// pauses indefinitely (relies on the explicit resume below to restore it).
LinkTapAccessory.prototype._pauseWateringPlan = function(callback) {
  var data = {
    username: username,
    apiKey: apiKey,
    gatewayId: gatewayId,
    taplinkerId: this.taplinkerId,
    pauseDuration: this.pauseHours,
    overwrite: 'always'
  };
  this.log("%s watering plan paused (%s)", this.name,
    this.pauseHours === -1 ? "indefinite" : this.pauseHours + "h");
  this._postLinkTap("pauseWateringPlan", data, callback);
};

// Resume by re-activating the configured watering plan mode. The LinkTap API has
// no standalone "resume" call (pauseDuration 0 is rejected with HTTP 400), so the
// app's "Deactivate" is implemented as re-activating the existing schedule.
LinkTapAccessory.prototype._resumeWateringPlan = function(callback) {
  var endpoint = SCHEDULE_MODE_ENDPOINTS[this.scheduleMode] || SCHEDULE_MODE_ENDPOINTS.sevenDay;
  var data = {
    username: username,
    apiKey: apiKey,
    gatewayId: gatewayId,
    taplinkerId: this.taplinkerId
  };
  this.log("%s watering plan resumed (re-activating %s)", this.name, endpoint);
  this._postLinkTap(endpoint, data, callback);
};

// Generic POST helper for LinkTap endpoints that just need a success/fail result
LinkTapAccessory.prototype._postLinkTap = function(endpoint, data, callback) {
  var self = this;
  var body = JSON.stringify(data);
  debug("%s body %s", endpoint, body);

  var req = https.request(_baseURL + endpoint, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, function(res) {
    var responseBody = '';
    res.on('data', function(chunk) { responseBody += chunk; });
    res.on('end', function() {
      debug('%s STATUS: %d %s', endpoint, res.statusCode, responseBody);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (callback) callback();
      } else {
        var err = new Error(endpoint + " returned HTTP " + res.statusCode + " " + responseBody);
        self.log.error(err.message);
        if (callback) callback(err);
      }
    });
  });

  req.on('error', function(error) {
    self.log.error("%s request failed: %s", endpoint, error.message);
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
  this._active = 0;
  this._inUse = 0;
  this._service.updateCharacteristic(Characteristic.Active, 0);
  this._service.updateCharacteristic(Characteristic.InUse, 0);
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
 * Possible future work:
 * - Characteristic.InUse / active watering state reflected live from polling
 * - Eco mode (eco / ecoOn / ecoOff) exposed as configurable options
 * - Water volume reporting for G2/G2S flow-meter devices
 **/
