require('dotenv').config()
const assert = require('chai').assert
const BotiumConnectorDialogflowCx = require('../../src/connector')
const Capabilities = require('../../src/Capabilities')
const { readCaps } = require('./helper')
const _ = require('lodash')

describe('connector', function () {
  beforeEach(async function () {
    this.init = async (caps) => {
      caps = Object.assign({}, readCaps(), caps)
      this.botMsgs = []
      const queueBotSays = (botMsg) => {
        if (this.botMsgPromiseResolve) {
          if (!_.isError(botMsg)) {
            this.botMsgPromiseResolve(botMsg)
          } else {
            this.botMsgPromiseReject(botMsg)
          }
          this.botMsgPromiseResolve = null
          this.botMsgPromiseReject = null
        } else {
          this.botMsgs.push(botMsg)
        }
      }
      this.connector = new BotiumConnectorDialogflowCx({
        queueBotSays,
        caps
      })
      await this.connector.Validate()
      await this.connector.Build()
      await this.connector.Start()

      this._nextBotMsg = async () => {
        const nextBotMsg = this.botMsgs.shift()
        if (nextBotMsg) {
          if (_.isError(nextBotMsg)) {
            throw nextBotMsg
          }
          return nextBotMsg
        }
        return new Promise((resolve, reject) => {
          this.botMsgPromiseResolve = resolve
          this.botMsgPromiseReject = reject
        })
      }
    }
  })

  it('should successfully get an answer for say hello', async function () {
    await this.init()
    await this.connector.UserSays({ messageText: 'hello' })
    const res = await this._nextBotMsg()
    assert.equal(res.messageText, 'Hi, I\'m your virtual healthcare agent. I can help answer your healthcare claims questions, understand your benefits, and find a doctor. How can I assist you today?')
  })

  it('should able to send event as button', async function () {
    await this.init()
    await this.connector.UserSays({ buttons: [{ payload: 'MyCustomEvent' }] })
    const res = await this._nextBotMsg()
    assert.equal(res.messageText, 'custom event received')
  })

  it('should successfully get the welcome message first, then the answer for the hello in non-legacy mode', async function () {
    await this.init({ [Capabilities.DIALOGFLOWCX_PROCESS_WELCOME_TEXT_RESPONSE]: true })
    // skip welcome message response
    const res0 = await this._nextBotMsg()
    assert.equal(res0.messageText, 'custom event received')
    await this.connector.UserSays({ messageText: 'hello' })
    const res = await this._nextBotMsg()
    assert.equal(res.messageText, 'Hi, I\'m your virtual healthcare agent. I can help answer your healthcare claims questions, understand your benefits, and find a doctor. How can I assist you today?')
  })

  it('should handle query parameters', async function () {
    await this.init({
      [Capabilities.DIALOGFLOWCX_QUERY_PARAMS]: {
        payload: {
          somePayloadKey: 'somePayloadValue'
        },
        parameters: {
          someParameterKey: 'someParameterValue'
        },
        webhookHeaders: {
          someWebhookHeaderKey: 'someWebhookHeaderValue'
        },
        analyzeQueryTextSentiment: true,
        sessionTtl: { seconds: '1' }
      }
    })
    await this.connector.UserSays({ messageText: 'hello' })
    const res = await this._nextBotMsg()
    assert.deepEqual(res.sourceData.parameters, {
      someParameterKey: 'someParameterValue'
    })
  }).timeout(20000)

  it('should add query parameters in welcome', async function () {
    await this.init({
      [Capabilities.DIALOGFLOWCX_PROCESS_WELCOME_TEXT_RESPONSE]: true,
      [Capabilities.DIALOGFLOWCX_QUERY_PARAMS]: {
        parameters: {
          someParameterKey: 'someParameterValue'
        }
      }
    })
    // skip welcome message response
    const res0 = await this._nextBotMsg()
    assert.equal(res0.messageText, 'custom event received')
    assert.deepEqual(res0.sourceData.parameters?.someParameterKey, 'someParameterValue')
  })

  it('should not add query parameters in welcome if its turned off', async function () {
    await this.init({
      [Capabilities.DIALOGFLOWCX_PROCESS_WELCOME_TEXT_RESPONSE]: true,
      [Capabilities.DIALOGFLOWCX_IGNORE_QUERY_PARAMS_FOR_WELCOME]: true,
      [Capabilities.DIALOGFLOWCX_QUERY_PARAMS]: {
        parameters: {
          someParameterKey: 'someParameterValue'
        }
      }
    })
    // skip welcome message response
    const res0 = await this._nextBotMsg()
    assert.equal(res0.messageText, 'custom event received')
    assert.notExists(res0.sourceData.parameters?.someParameterKey)
  })

  it('should extract global info for test coverage', async function () {
    await this.init({ [Capabilities.DIALOGFLOWCX_EXTRACT_TEST_COVERAGE]: true })

    const res = await this.connector.GetMetaData({})

    assert.equal(res.dialogflowcx.startFlowId, '00000000-0000-0000-0000-000000000000')

    assert.deepEqual(res.dialogflowcx.intentIdToIntent['00000000-0000-0000-0000-000000000000'], {
      path: 'projects/dialogflowcx-demo-302308/locations/europe-west2/agents/f17dc3a1-c93d-41f9-ba00-5a752750f380/intents/00000000-0000-0000-0000-000000000000',
      displayName: 'Default Welcome Intent',
      used: true
    })

    const defStartFlow = res.dialogflowcx.flowIdToFlow['00000000-0000-0000-0000-000000000000']
    assert.equal(defStartFlow.path, 'projects/dialogflowcx-demo-302308/locations/europe-west2/agents/f17dc3a1-c93d-41f9-ba00-5a752750f380/flows/00000000-0000-0000-0000-000000000000')
    assert.equal(defStartFlow.displayName, 'Default Start Flow')
    assert.deepEqual(defStartFlow.transitionRoutes[0], {
      id: '55720da2-0441-4ea6-858a-97b60276d717',
      intentId: '00000000-0000-0000-0000-000000000000',
      flowId: '00000000-0000-0000-0000-000000000000',
      targetFlowId: undefined,
      targetCommand: undefined,
      targetPageId: '779b4d96-3688-416d-8355-03e57c98fcbc',
      condition: ''
    })
    const page = res.dialogflowcx.pageIdToPage['3603055e-e839-4ff1-aca3-5cf9f7bba0b2']
    assert.equal(page.path, 'projects/dialogflowcx-demo-302308/locations/europe-west2/agents/f17dc3a1-c93d-41f9-ba00-5a752750f380/flows/00000000-0000-0000-0000-000000000000/pages/3603055e-e839-4ff1-aca3-5cf9f7bba0b2')
    assert.equal(page.displayName, 'Symptoms')
    assert.equal(page.flowId, '00000000-0000-0000-0000-000000000000')
    assert.deepEqual(page.transitionRoutes[0], {
      id: '390d5889-55ab-49ad-9868-9bb0eaebfda8',
      pageId: '3603055e-e839-4ff1-aca3-5cf9f7bba0b2',
      intentId: '518e20c8-56cb-49b7-b74b-6ff2d9049012',
      targetFlowId: '0d6968d1-b0c0-41d0-a6ee-0ed7bc3453c7',
      targetCommand: undefined,
      targetPageId: undefined,
      condition: ''
    })
  }).timeout(20000)

  afterEach(async function () {
    if (this.connector) {
      await this.connector.Stop()
      await this.connector.Clean()
    }
    this.botMsgPromiseResolve = null
    this.botMsgPromiseReject = null
    this.botMsgs = null
    this._nextBotMsg = null
    this.init = null
    this.connector = null
  })
})
