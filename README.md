# Botium Connector for Google Dialogflow CX

[![NPM](https://nodei.co/npm/botium-connector-dialogflowcx.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-dialogflowcx/)

[![npm version](https://badge.fury.io/js/botium-connector-dialogflowcx.svg)](https://badge.fury.io/js/botium-connector-dialogflowcx)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()

This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing your Dialogflow CX Agents.

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles ? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works ?
Botium runs your conversations against the Dialogflow CX API.

It can be used as any other Botium connector with all Botium Stack components:
  * [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
  * [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
  * [Botium Box](https://www.botium.ai)

## Requirements

* __Node.js and NPM__
* a __Dialogflow CX__ agent, and user account with administrative rights
* a __project directory__ on your workstation to hold test cases and Botium configuration

## Install Botium and Dialogflow CX Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-dialogflowcx
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-dialogflowcx
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Connecting Dialogflow Agent to Botium

Open the file _botium.json_ in your working directory and add the [Google credentials](https://cloud.google.com/docs/authentication/getting-started) for accessing your Dialogflow agent. Project Id, Agent Id and Location can be found in the [Dialogflow CX Console](https://cloud.google.com/dialogflow/cx/docs/quick/api).

Following permissions/roles are required to use botium:

### To test:
#### Permission:
dialogflow.sessions.detectIntent
#### We suggest to use one of the following roles:
roles/dialogflow.client
roles/dialogflow.consoleSimulatorUser

###  To use downloader (optional):
#### Permissions:
dialogflow.intents.list
dialogflow.agents.get
dialogflow.flows.get
dialogflow.pages.get
#### Many roles can be good, for example
roles/dialogflow.aamViewer
### To use uploader (optional):
#### Permissions:
dialogflow.intents.*
#### Following role have this permission:
roles/dialogflow.intentAdmin

You can read about Google Dialogflow roles [here](https://cloud.google.com/iam/docs/understanding-roles#dialogflow-roles) 

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "dialogflowcx",
      "DIALOGFLOWCX_PROJECT_ID": "<google project id>",
      "DIALOGFLOWCX_AGENT_ID": "<agent id>",
      "DIALOGFLOWCX_LOCATION": "<location>",
      "DIALOGFLOWCX_CLIENT_EMAIL": "<service credentials email>",
      "DIALOGFLOWCX_PRIVATE_KEY": "<service credentials private key>"
    }
  }
}
```

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __dialogflowcx__ to activate this connector.

### DIALOGFLOWCX_PROJECT_ID

Google project id.

### DIALOGFLOWCX_LOCATION

Location

### DIALOGFLOWCX_AGENT_ID

Location

### DIALOGFLOWCX_ENVIRONMENT

Dialogflow publishing environment name. See [This article](https://cloud.google.com/dialogflow/cx/docs/concept/version)

### DIALOGFLOWCX_CLIENT_EMAIL
_Optional_

Google client email. If not given, [Google default authentication](https://cloud.google.com/docs/authentication/getting-started) will be used.

### DIALOGFLOWCX_PRIVATE_KEY
_Optional_

Google private key. If not given, [Google default authentication](https://cloud.google.com/docs/authentication/getting-started) will be used.

### DIALOGFLOWCX_LANGUAGE_CODE

The language of this conversational query. See [all languages](https://dialogflow.com/docs/reference/language).

### DIALOGFLOWCX_QUERY_PARAMS

Query parameters as JSON struct.

### DIALOGFLOWCX_WELCOME_TEXT

Welcome text(s) to send to the Dialogflow CX agent for initiating the session.

It is possible to send button/event instead of text
```
"DIALOGFLOWCX_WELCOME_TEXT": {"buttons": [{"payload": "MyCustomEvent"}]}
```
