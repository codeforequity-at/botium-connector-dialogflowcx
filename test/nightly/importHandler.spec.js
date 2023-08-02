require('dotenv').config()
const assert = require('chai').assert
const { importHandler } = require('../../src/intents')
const { readCaps } = require('./helper')

describe('importhandler', function () {
  beforeEach(async function () {
    this.caps = readCaps()
  })
  it('should successfully download intents', async function () {
    const result = await importHandler({ caps: this.caps })
    assert.isFalse(!!result.convos?.length)
    assert.isAbove(result.utterances.length, 0)
    const utterance = result.utterances.find(u => (u.name === 'Default Welcome Intent'))

    assert.isTrue(!!utterance, '"Default Welcome Intent" intent not found')
    assert.equal(utterance.name, 'Default Welcome Intent')
    assert.isTrue(utterance.utterances.includes('greetings'))
    assert.isTrue(utterance.utterances.includes('hey'))
  }).timeout(10000)
})
