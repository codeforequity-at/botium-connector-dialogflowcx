require('dotenv').config()
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const { readCaps } = require('./helper')
const Capabilities = require('../../src/Capabilities')

describe('importhandler', function () {
  beforeEach(async function () {
    this.caps = readCaps()
  })

  describe('TrainingSetUtteranceIncluded', function () {
    it('should successfully download intents included in transaction by env, draft', async function () {
      const caps = Object.assign({}, this.caps, {
        [Capabilities.DIALOGFLOWCX_ENVIRONMENT]: undefined
      })
      const result = await importHandler({ source: 'TrainingSetUtteranceIncluded', caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NOT_USED_INTENT')))

      // this intent is bound to transaction just on env
      assert.isFalse(!!result.utterances.find(u => (u.name === 'CheckIsEnvironment')))

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NotUsedNotAddedToEnv001')))
    }).timeout(20000)

    it('should successfully download intents included in transaction by env, env', async function () {
      const caps = this.caps
      const result = await importHandler({ source: 'TrainingSetUtteranceIncluded', caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NOT_USED_INTENT')))

      // this intent is bound to transaction just on env
      assert.isTrue(!!result.utterances.find(u => (u.name === 'CheckIsEnvironment')))
    }).timeout(20000)

    it('should successfully download intents included in transaction by env, de', async function () {
      const caps = Object.assign({}, this.caps, {
        [Capabilities.DIALOGFLOWCX_ENVIRONMENT]: undefined,
        [Capabilities.DIALOGFLOWCX_LANGUAGE_CODE]: 'de_DE'
      })
      const result = await importHandler({ source: 'TrainingSetUtteranceIncluded', caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      const welcome = result.utterances.find(u => (u.name === 'Default Welcome Intent'))
      assert.isTrue(!!welcome)
      assert.isTrue(welcome.utterances.includes('grüß dich'))

      const agent = result.utterances.find(u => (u.name === 'healthcare.agent_transfer'))
      assert.isTrue(!!agent)
      assert.isTrue(agent.utterances.includes('I\'d like to speak to an agent'))
    }).timeout(20000)
  })

  describe('TrainingSetUtterance', function () {
    it('should successfully download all by env, daft', async function () {
      const caps = Object.assign({}, this.caps, {
        [Capabilities.DIALOGFLOWCX_ENVIRONMENT]: undefined
      })
      const result = await importHandler({ source: 'TrainingSetUtterance', caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      assert.isTrue(!!result.utterances.find(u => (u.name === 'NotUsedNotAddedToEnv001')))
    }).timeout(20000)

    it('should successfully download all by env, env', async function () {
      const caps = this.caps
      const result = await importHandler({ source: 'TrainingSetUtterance', caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NotUsedNotAddedToEnv001')))

      assert.isTrue(!!result.utterances.find(u => (u.name === 'Default Welcome Intent')))
    }).timeout(20000)
  })

  // Legacy
  describe('TrainingSet', function () {
    it('should work with TrainingSet (crawl convo false) similar as TrainingSetUtteranceIncluded', async function () {
      const result = await importHandler({ source: 'TrainingSet', caps: this.caps })

      assert.isFalse(!!result.convos?.length)
      assert.isAbove(result.utterances.length, 0)

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NOT_USED_INTENT')))

      // this intent is bound to transaction just on env
      assert.isTrue(!!result.utterances.find(u => (u.name === 'CheckIsEnvironment')))
    }).timeout(20000)
  })

  describe('TrainingSetConvo', function () {
    it('should successfully download convos, but just from draft', async function () {
      const result = await importHandler({ source: 'TrainingSetConvo', caps: this.caps })

      assert.isAbove(result.convos.length, 0)
      assert.isAbove(result.utterances.length, 0)

      assert.isFalse(!!result.utterances.find(u => (u.name === 'NOT_USED_INTENT')))

      // this intent is bound to transaction just on env
      assert.isFalse(!!result.utterances.find(u => (u.name === 'CheckIsEnvironment')))

      assert.isTrue(!!result.utterances.find(u => (u.name === 'Default Welcome Intent')))
    }).timeout(20000)
  })

  describe('TestSet', function () {
    it('should successfully download convos from Dialogflow CX testcases', async function () {
      const result = await importHandler({ caps: this.caps, source: 'TestSet' })
      assert.equal(result.convos.length, 7)
      assert.isTrue(!result.utterances?.length)

      const findDoctorConvo = result.convos.find(c => c.header.name === 'find doctor')
      assert.isTrue(!!findDoctorConvo)
      assert.equal(findDoctorConvo.header.externalId, '01f17169eb7ca87248743563b8777ead')
      assert.deepEqual(findDoctorConvo.conversation[0], {
        messageText: 'find doctor',
        sender: 'me'
      })

      const dtmfConvo = result.convos.find(c => c.header.name === 'dtmf')
      assert.isTrue(!!dtmfConvo)
      assert.equal(dtmfConvo.header.externalId, '842cb77d488d17b0fd81fd781134b662')
      assert.deepEqual(dtmfConvo.conversation, [
        {
          sender: 'me'
        },
        {
          messageText: [
            'Apologies, I am here to answer your questions about your healthcare claims, understanding your benefits and finding a doctor.'
          ],
          sender: 'bot'
        }
      ])

      const eventConvo = result.convos.find(c => c.header.name === 'event')
      assert.isTrue(!!eventConvo)
      assert.equal(eventConvo.header.externalId, 'b23f306b5679b67099b6e4001ef0d21e')
      assert.deepEqual(eventConvo.conversation[3], {
        messageText: [
          'MyCustomEvent received'
        ],
        sender: 'bot'
      })

      const parametersConvo = result.convos.find(c => c.header.name === 'parameters')
      assert.isTrue(!!parametersConvo)
      assert.equal(parametersConvo.header.externalId, '33f577906a10f3ef993a6aea59ca0571')
      assert.deepEqual(parametersConvo.conversation[2], {
        logicHooks: [
          {
            args: [
              'SET_DIALOGFLOWCX_QUERYPARAMS',
              '{"parameters":{"param":"paramvalue"}}'
            ],
            name: 'UPDATE_CUSTOM'
          }
        ],
        messageText: 'hello with params',
        sender: 'me'
      })

      const changingparamsConvo = result.convos.find(c => c.header.name === 'changingparams')
      assert.isTrue(!!changingparamsConvo)
      assert.equal(changingparamsConvo.header.externalId, 'eb824d27008386761230eebdcabe2465')
      assert.deepEqual(changingparamsConvo.conversation[0], {
        messageText: 'hello',
        sender: 'me'
      })
      assert.deepEqual(changingparamsConvo.conversation[2], {
        logicHooks: [
          {
            args: [
              'SET_DIALOGFLOWCX_QUERYPARAMS',
              '{"disableWebhook":true}'
            ],
            name: 'UPDATE_CUSTOM'
          }
        ],
        messageText: 'hello, differentsettings',
        sender: 'me'
      })
    }).timeout(20000)
  })
})
