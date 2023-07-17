require('dotenv').config()
const assert = require('chai').assert
const BotiumConnectorDialogflowCx = require('../../src/connector')
const { readCaps } = require('./helper')
const _ = require('lodash')

describe('connector', function () {
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
    this.connector = new BotiumConnectorDialogflowCx({ queueBotSays, caps: this.caps })
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

  it('should able to send parameters as part of the convo', async function () {
    await this.connector.UserSays({ buttons: [{ payload: 'MyCustomEvent' }] })
    const res = await this._nextBotMsg()
    assert.equal(res.messageText, 'custom event received')
  })

  afterEach(async function () {
    await this.connector.Stop()
  })
})
