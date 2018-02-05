# homebridge-platform-linktap 

[![npm package](https://nodei.co/npm/homebridge-platform-linktap.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-platform-linktap/)

[![NPM Version](https://img.shields.io/npm/v/homebridge-platform-linktap.svg)](https://www.npmjs.com/package/homebridge-platform-linktap)
[![Dependency Status](https://img.shields.io/versioneye/d/nodejs/homebridge-platform-linktap.svg)](https://www.versioneye.com/nodejs/homebridge-platform-linktap/)
[![Slack Channel](https://img.shields.io/badge/slack-platform--linktap-brightgreen.svg)](https://homebridgeteam.slack.com/messages/C93QDKXSP/)


LinkTap Platform Plugin for the [Homebridge](https://github.com/nfarina/homebridge) project.

# Note - seriously WIP

This package is currently being developed and is a WORK IN PROGRESS. Its currently in the ALPHA stage. 

## LinkTap

[LinkTap] (https://www.link-tap.com) is a wireless tap that is controlled by the LinkTap's wireless bridge.
There is a published LinkTap [API](https://www.link-tap.com/#!/api-for-developers). 

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-platform-linktap`
3. Update your configuration file. See the sample below.

# Updating

npm update -g homebridge-platform-linktap

# Configuration

Configuration sample:

 ```javascript
// this is an example please do not copy/paste.

"platforms":[
    {
        "platform": "LinkTapPlatform",
        "username": "test",				//Required. String type. Your LinkTap account's username
        "apiKey": "a6f1223d1fe191f8ec55662d1eb45720'",	//Required. String type. Your API key
        "gatewayId": "3F7A23FE004B1200",		//Required. String type. Your LinkTap Gateway's first 16-digits/letters ID, case insensitive, no dash symbol
        "taps": [
            {
                "name": "lawn",				//Required. LinkTap name friendly name.
                "location": "Front yard",		//Optional. friendly location name.
                "taplinkerId": "67ABCDEF004B1200",	//Required. String type. Your LinkTap Taplinker's first 16-digits/letters ID, case insensitive, no dash symbol
                "duration": 1				//Required. The watering duration (unit is minutes) 1..1439 minutes. Default 1 minute.
           }
	]
    }
]
```

# Known Issues

These are currently the known issues
- API calls are failing
- Cannot read the username, apiKey and gatewayId keys from the config. 
- the hierarchy of LinkTapPlatform > LinkTap(s) may be broken (IDK yet). 

# Credits

Credit goes to
- michaelfro for his work on [homebridge-delayed-switches](https://github.com/grover/homebridge-delayed-switches) that this is work is based on.

# License

Published under the MIT License.
