require('dotenv').config()
const assert = require('chai').assert
const BotiumConnectorDialogflowCx = require('../../src/connector')
const Capabilities = require('../../src/Capabilities')
const { readCaps } = require('./helper')
const _ = require('lodash')

describe('connector', function () {
  describe('skipping welcome message response (legacy mode)', function () {
    beforeEach(async function () {
      this.caps = readCaps()
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
        caps: this.caps
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
    })

    it('should successfully get an answer for say hello', async function () {
      await this.connector.UserSays({ messageText: 'hello' })
      const res = await this._nextBotMsg()
      assert.equal(res.messageText, 'Hi, I\'m your virtual healthcare agent. I can help answer your healthcare claims questions, understand your benefits, and find a doctor. How can I assist you today?')
    })

    it('should able to send event as button', async function () {
      await this.connector.UserSays({ buttons: [{ payload: 'MyCustomEvent' }] })
      const res = await this._nextBotMsg()
      assert.equal(res.messageText, 'custom event received')
    })

    afterEach(async function () {
      await this.connector.Stop()
    })
  })
  describe('processing welcome message response', function () {
    beforeEach(async function () {
      this.caps = readCaps()
      this.caps[Capabilities.DIALOGFLOWCX_PROCESS_WELCOME_TEXT_RESPONSE] = true
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
        caps: this.caps
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
    })

    it('should successfully get the welcome message first, then the answer for the hello', async function () {
      // skip welcome message response
      const res0 = await this._nextBotMsg()
      assert.equal(res0.messageText, 'custom event received')
      await this.connector.UserSays({ messageText: 'hello' })
      const res = await this._nextBotMsg()
      assert.equal(res.messageText, 'Hi, I\'m your virtual healthcare agent. I can help answer your healthcare claims questions, understand your benefits, and find a doctor. How can I assist you today?')
    })

    afterEach(async function () {
      await this.connector.Stop()
    })
  })
})
