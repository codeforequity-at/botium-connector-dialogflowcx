require('dotenv').config()
const assert = require('chai').assert
const { readCaps } = require('./helper')
const api = require('../../src/api')
const { PluginDesc } = require('../../index')

describe('api', function () {
  it('should read flows', async function () {
    const flows = await api.getFlows({ caps: await readCaps() })

    assert.equal(flows.length, 5)
    assert.equal(flows[0].name, 'Default Start Flow')
  })

  it('should read environments', async function () {
    const getEnvironments = PluginDesc.capabilities.find(c => c.name === 'DIALOGFLOWCX_ENVIRONMENT').query
    const environments = await getEnvironments(readCaps())

    assert.equal(environments.length, 1)
    assert.equal(environments[0].name, 'Env 001')
  })
})
