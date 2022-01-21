const { v1: uuidV1 } = require('uuid')
const { SessionsClient } = require('@google-cloud/dialogflow-cx')
const _ = require('lodash')
const debug = require('debug')('botium-connector-dialogflowcx')
const { struct } = require('../structJson')
const Capabilities = require('./Capabilities')

const Defaults = {
  [Capabilities.DIALOGFLOWCX_LANGUAGE_CODE]: 'en'
}

class BotiumConnectorDialogflowCX {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
  }

  async Validate () {
    debug('Validate called')
    this.caps = Object.assign({}, Defaults, this.caps)

    if (!this.caps[Capabilities.DIALOGFLOWCX_PROJECT_ID]) throw new Error('DIALOGFLOWCX_PROJECT_ID capability required')
    if (!this.caps[Capabilities.DIALOGFLOWCX_AGENT_ID]) throw new Error('DIALOGFLOWCX_AGENT_ID capability required')
    if (!!this.caps[Capabilities.DIALOGFLOWCX_CLIENT_EMAIL] !== !!this.caps[Capabilities.DIALOGFLOWCX_PRIVATE_KEY]) throw new Error('DIALOGFLOWCX_CLIENT_EMAIL and DIALOGFLOWCX_PRIVATE_KEY capabilities both or none required')
  }

  async Build () {
    debug('Build called')

    this.sessionOpts = {
      fallback: true
    }

    if (this.caps[Capabilities.DIALOGFLOWCX_CLIENT_EMAIL] && this.caps[Capabilities.DIALOGFLOWCX_PRIVATE_KEY]) {
      this.sessionOpts.credentials = {
        client_email: this.caps[Capabilities.DIALOGFLOWCX_CLIENT_EMAIL],
        private_key: this.caps[Capabilities.DIALOGFLOWCX_PRIVATE_KEY]
      }
    }
    if (this.caps[Capabilities.DIALOGFLOWCX_LOCATION]) {
      this.sessionOpts.apiEndpoint = `${this.caps[Capabilities.DIALOGFLOWCX_LOCATION]}-dialogflow.googleapis.com`
      debug(`Using Dialogflow apiEndpoint: ${this.sessionOpts.apiEndpoint}`)
    }
  }

  async Start () {
    debug('Start called')

    this.conversationId = uuidV1()
    this.queryParams = {}

    if (this.caps[Capabilities.DIALOGFLOWCX_QUERY_PARAMS]) {
      if (_.isString(this.caps[Capabilities.DIALOGFLOWCX_QUERY_PARAMS])) {
        Object.assign(this.queryParams, JSON.parse(this.caps[Capabilities.DIALOGFLOWCX_QUERY_PARAMS]))
      } else {
        Object.assign(this.queryParams, this.caps[Capabilities.DIALOGFLOWCX_QUERY_PARAMS])
      }
    }

    this.sessionClient = new SessionsClient(this.sessionOpts)
    if (this.caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]) {
      this.sessionPath = this.sessionClient.projectLocationAgentEnvironmentSessionPath(this.caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], this.caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', this.caps[Capabilities.DIALOGFLOWCX_AGENT_ID], this.caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT], this.conversationId)
    } else {
      this.sessionPath = this.sessionClient.projectLocationAgentSessionPath(this.caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], this.caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', this.caps[Capabilities.DIALOGFLOWCX_AGENT_ID], this.conversationId)
    }
    debug(`Using Dialogflow SessionPath: ${this.sessionPath}`)
  }

  UserSays (msg) {
    debug('UserSays called')
    if (!this.sessionClient) return Promise.reject(new Error('not built'))

    const request = {
      session: this.sessionPath,
      queryInput: {
        languageCode: this.caps[Capabilities.DIALOGFLOWCX_LANGUAGE_CODE]
      }
    }
    if (msg.media && msg.media.length > 0) {
      const media = msg.media[0]
      if (!media.buffer) {
        return Promise.reject(new Error(`Media attachment ${media.mediaUri} not downloaded`))
      }
      if (!media.mimeType || !media.mimeType.startsWith('audio')) {
        return Promise.reject(new Error(`Media attachment ${media.mediaUri} mime type ${media.mimeType || '<empty>'} not supported (audio only)`))
      }

      request.queryInput.audio = {
        config: {},
        audio: media.buffer
      }

      if (!msg.attachments) {
        msg.attachments = []
      }
      msg.attachments.push({
        name: media.mediaUri,
        mimeType: media.mimeType,
        base64: media.buffer.toString('base64')
      })
    } else {
      request.queryInput.text = {
        text: msg.messageText
      }
    }

    const mergeQueryParams = {}
    if (msg.SET_DIALOGFLOWCX_QUERYPARAMS) {
      Object.assign(mergeQueryParams, msg.SET_DIALOGFLOWCX_QUERYPARAMS)
    }

    request.queryParams = Object.assign({}, this.queryParams, mergeQueryParams)
    if (request.queryParams.payload) {
      request.queryParams.payload = struct.encode(request.queryParams.payload)
    }
    if (request.queryParams.parameters) {
      request.queryParams.parameters = struct.encode(request.queryParams.parameters)
    }

    debug(`dialogflow request: ${JSON.stringify(_.omit(request, ['queryInput.audio']), null, 2)}`)
    msg.sourceData = request

    return this.sessionClient.detectIntent(request)
      .then((responses) => {
        const response = responses[0]

        if (response.queryResult.diagnosticInfo) {
          response.queryResult.diagnosticInfo = struct.decode(response.queryResult.diagnosticInfo)
        }
        if (response.queryResult.parameters) {
          response.queryResult.parameters = struct.decode(response.queryResult.parameters)
        }
        if (response.queryResult.match && response.queryResult.match.parameters) {
          response.queryResult.match.parameters = struct.decode(response.queryResult.match.parameters)
        }
        for (const responseMessage of response.queryResult.responseMessages) {
          if (responseMessage.payload) {
            responseMessage.payload = struct.decode(responseMessage.payload)
          }
        }
        debug(`dialogflow response: ${JSON.stringify(_.omit(response, ['queryResult.diagnosticInfo', 'outputAudio']), null, 2)}`)
        const nlp = {
          intent: this._extractIntent(response),
          entities: this._extractEntities(response)
        }
        const audioAttachment = this._getAudioOutput(response)
        const attachments = audioAttachment ? [audioAttachment] : []

        for (const responseMessage of response.queryResult.responseMessages) {
          if (Object.keys(responseMessage).length === 0) continue
          const messageText = responseMessage.text && responseMessage.text.text && responseMessage.text.text[0]
          setTimeout(() => this.queueBotSays({ sender: 'bot', messageText, sourceData: response.queryResult, nlp, attachments }), 0)
        }
      }).catch((err) => {
        debug(err)
        throw new Error(`Cannot send message to dialogflow container: ${err.message}, request: ${JSON.stringify(request)}`)
      })
  }

  Stop () {
    debug('Stop called')
    this.sessionClient = null
    this.sessionPath = null
  }

  Clean () {
    debug('Clean called')
    this.sessionOpts = null
  }

  _getAudioOutput (response) {
    if (response.outputAudio && response.outputAudioConfig) {
      const acSrc = JSON.parse(JSON.stringify(response.outputAudioConfig))
      const attachment = {
      }
      if (acSrc.audioEncoding === 'OUTPUT_AUDIO_ENCODING_LINEAR_16') {
        attachment.name = 'output.wav'
        attachment.mimeType = 'audio/wav'
      } else if (acSrc.audioEncoding === 'OUTPUT_AUDIO_ENCODING_MP3') {
        attachment.name = 'output.mp3'
        attachment.mimeType = 'audio/mpeg3'
      } else if (acSrc.audioEncoding === 'OUTPUT_AUDIO_ENCODING_OGG_OPUS') {
        attachment.name = 'output.ogg'
        attachment.mimeType = 'audio/ogg'
      }
      if (attachment.name) {
        attachment.base64 = Buffer.from(response.outputAudio).toString('base64')
        return attachment
      }
    }
  }

  _extractIntent (response) {
    if (response.queryResult.match && response.queryResult.match.intent) {
      return {
        name: response.queryResult.match.intent.displayName,
        confidence: response.queryResult.match.confidence
      }
    }
    return {}
  }

  _extractEntities (response) {
    if (response.queryResult.match && response.queryResult.match.parameters && Object.keys(response.queryResult.match.parameters).length > 0) {
      return this._extractEntitiesFromFields('', response.queryResult.match.parameters)
    }
    return []
  }

  _extractEntitiesFromFields (keyPrefix, fields) {
    return Object.keys(fields).reduce((entities, key) => {
      return entities.concat(this._extractEntityValues(`${keyPrefix ? keyPrefix + '.' : ''}${key}`, fields[key]))
    }, [])
  }

  _extractEntityValues (key, field) {
    if (_.isNull(field) || _.isUndefined(field)) {
      return []
    } else if (_.isString(field) || _.isNumber(field) || _.isBoolean(field)) {
      return [{
        name: key,
        value: field
      }]
    } else if (_.isArray(field)) {
      return field.reduce((entities, lv, i) => {
        return entities.concat(this._extractEntityValues(`${key}.${i}`, lv))
      }, [])
    } else if (_.isObject(field)) {
      return this._extractEntitiesFromFields(key, field)
    }
    debug(`Unsupported entity kind for ${key}, skipping entity.`)
    return []
  }
}

module.exports = BotiumConnectorDialogflowCX
