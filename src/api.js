const { AgentsClient, FlowsClient, TestCasesClient, protos } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')
const AdmZip = require('adm-zip')

const downloadChatbot = async ({ caps }) => {
  const status = (log, obj) => {
    if (obj) {
      debug(log, obj)
    } else {
      debug(log)
    }
  }

  const driver = new BotDriver(caps)
  const container = await driver.Build()

  try {
    const client = new AgentsClient(container.pluginInstance.sessionOpts)

    try {
      const exportAgentRequest =
        new protos.google.cloud.dialogflow.cx.v3.ExportAgentRequest()

      exportAgentRequest.name = `projects/${caps[Capabilities.DIALOGFLOWCX_PROJECT_ID]}/locations/${caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global'}/agents/${caps[Capabilities.DIALOGFLOWCX_AGENT_ID]}`
      exportAgentRequest.dataFormat = 'JSON_PACKAGE'
      if (caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]) {
        exportAgentRequest.environment = client.environmentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID], caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT])
      }
      status(`Using Dialogflow CX project "${exportAgentRequest.name}" environment ${exportAgentRequest.environment}`)
      // exportAgent call returns a promise to a long running operation
      const [operation] = await client.exportAgent(exportAgentRequest)

      // Waiting for the long running opporation to finish
      const [response] = await operation.promise()

      return new AdmZip(Buffer.from(response.agentContent || response.response.value, 'base64'))
    } catch (err) {
      throw new Error(`Dialogflow CX API download current intents failed: ${err && err.message}`)
    }
  } finally {
    if (container) {
      try {
        await container.Clean()
      } catch (err) {
        debug(`Error container cleanup: ${err && err.message}`)
      }
    }
  }
}

const getFlows = async ({ caps }) => {
  const driver = new BotDriver(caps)
  const container = await driver.Build()
  try {
    const flowsClient = new FlowsClient(container.pluginInstance.sessionOpts)
    const [flows] = await flowsClient.listFlows({
      parent: flowsClient.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID]),
      pageSize: 1000
    })
    return flows.map(flow => ({ id: flow.name, name: flow.displayName }))
  } finally {
    if (container) {
      try {
        await container.Clean()
      } catch (err) {
        debug(`Error container cleanup: ${err && err.message}`)
      }
    }
  }
}

// raw implementation for testcase to convo conversion
// created just for one-time-use.
const getTestCases = async ({ caps }) => {
  const driver = new BotDriver(caps)
  const container = await driver.Build()
  try {
    const client = new AgentsClient(container.pluginInstance.sessionOpts)
    const testCasesClient = new TestCasesClient(container.pluginInstance.sessionOpts)
    const [testCases] = await testCasesClient.listTestCases({
      parent: client.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID]),
      pageSize: 20,
      view: 'FULL'
    })

    const convos = []
    for (const testcase of testCases) {
      let convo = `Convo ${testcase.displayName}\n`
      for (const { userInput, virtualAgentOutput } of testcase.testCaseConversationTurns) {
        convo += '#me\n'
        convo += (userInput.input.text?.text || '!!!!!!!!!!!!!!!!!!!!!!') + '\n'
        convo += '#bot\n'
        if (virtualAgentOutput.triggeredIntent?.displayName) {
          convo += `INTENT ${virtualAgentOutput.triggeredIntent?.displayName}`
        }
        convo += (virtualAgentOutput.textResponses.map(({ text }) => text).join(' ') || '!!!!!!!!!!!!!!!!!') + '\n'
        convos.push(convo)
      }
    }

    return { testCases, convos }
  } finally {
    if (container) {
      try {
        await container.Clean()
      } catch (err) {
        debug(`Error container cleanup: ${err && err.message}`)
      }
    }
  }
}

module.exports = {
  downloadChatbot,
  getFlows,
  getTestCases
}
