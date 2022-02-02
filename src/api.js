const fs = require('fs')
const { AgentsClient, FlowsClient, protos } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')

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

      exportAgentRequest.name = `projects/${caps[Capabilities.DIALOGFLOWCX_PROJECT_ID]}/locations/${caps[Capabilities.DIALOGFLOWCX_LOCATION]}/agents/${caps[Capabilities.DIALOGFLOWCX_AGENT_ID]}`
      if (caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]) {
        exportAgentRequest.environment = caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]
      }
      status(`Using Dialogflow CX project "${exportAgentRequest.name}" environment ${exportAgentRequest.environment}`)
      // exportAgent call returns a promise to a long running operation
      const [operation] = await client.exportAgent(exportAgentRequest)

      // Waiting for the long running opporation to finish
      const [response] = await operation.promise()

      // Prints the result of the operation when the operation is done
      fs.writeFileSync('chatbot.bin', response.agentContent, 'binary')
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

module.exports = {
  downloadChatbot,
  getFlows
}
