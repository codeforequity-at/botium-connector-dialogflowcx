const { v1: uuidV1 } = require('uuid')
const { SessionsClient } = require('@google-cloud/dialogflow-cx')
const _ = require('lodash')
const debug = require('debug')('botium-connector-dialogflowcx')

const Capabilities = {
  DIALOGFLOWCX_PROJECT_ID: 'DIALOGFLOWCX_PROJECT_ID',
  DIALOGFLOWCX_LOCATION: 'DIALOGFLOWCX_LOCATION',
  DIALOGFLOWCX_AGENT_ID: 'DIALOGFLOWCX_AGENT_ID',
  DIALOGFLOWCX_ENVIRONMENT: 'DIALOGFLOWCX_ENVIRONMENT',
  DIALOGFLOWCX_CLIENT_EMAIL: 'DIALOGFLOWCX_CLIENT_EMAIL',
  DIALOGFLOWCX_PRIVATE_KEY: 'DIALOGFLOWCX_PRIVATE_KEY',
  DIALOGFLOWCX_LANGUAGE_CODE: 'DIALOGFLOWCX_LANGUAGE_CODE'
}

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
    debug(`dialogflow request: ${JSON.stringify(_.omit(request, ['queryInput.audio']), null, 2)}`)
    msg.sourceData = request

    return this.sessionClient.detectIntent(request)
      .then((responses) => {
        const response = responses[0]

        debug(`dialogflow response: ${JSON.stringify(_.omit(response, ['queryResult.diagnosticInfo', 'outputAudio']), null, 2)}`)
        const nlp = {
          intent: this._extractIntent(response)
        }
        const audioAttachment = this._getAudioOutput(response)
        const attachments = audioAttachment ? [audioAttachment] : []

        for (const responseMessage of response.queryResult.responseMessages) {
          if (responseMessage.text) {
            if (responseMessage.text.text) {
              setTimeout(() => this.queueBotSays({ sender: 'bot', messageText: responseMessage.text.text[0], sourceData: response.queryResult, nlp, attachments }), 0)
            }
          }
        }
      }).catch((err) => {
        debug(err)
        throw new Error(`Cannot send message to dialogflow container: ${err.message}`)
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
}

module.exports = BotiumConnectorDialogflowCX
