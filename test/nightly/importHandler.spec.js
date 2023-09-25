require('dotenv').config()
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const { readCaps } = require('./helper')

describe('importhandler', function () {
  beforeEach(async function () {
    this.caps = readCaps()
  })
  it('should successfully download intent   s', async function () {
    const result = await importHandler({ caps: this.caps })
    assert.isFalse(!!result.convos?.length)
    assert.isAbove(result.utterances.length, 0)
    const utterance = result.utterances.find(u => (u.name === 'Default Welcome Intent'))

    assert.isTrue(!!utterance, '"Default Welcome Intent" intent not found')
    assert.equal(utterance.name, 'Default Welcome Intent')
    assert.isTrue(utterance.utterances.includes('greetings'))
    assert.isTrue(utterance.utterances.includes('hey'))
  }).timeout(20000)
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
            'SET_DIALOGFLOW_CONTEXT',
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
            'SET_DIALOGFLOW_CONTEXT',
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
