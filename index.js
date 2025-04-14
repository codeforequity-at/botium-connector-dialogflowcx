const _ = require('lodash')
const {
  AgentsClient,
  EnvironmentsClient,
  IntentsClient,
  FlowsClient,
  PagesClient
} = require('@google-cloud/dialogflow-cx')
const BotiumConnectorDialogflowCX = require('./src/connector')
const { importHandler, importArgs, exportHandler, exportArgs } = require('./src/intents')
const { getFlows } = require('./src/api')
const Capabilities = require('./src/Capabilities')
const {
  getList
} = require('./src/helper')
const { pRateLimit } = require('p-ratelimit')
module.exports = {
  PluginVersion: 1,
  Import: {
    Handler: importHandler,
    Args: importArgs
  },
  Export: {
    Handler: exportHandler,
    Args: exportArgs
  },
  PluginClass: BotiumConnectorDialogflowCX,
  PluginDesc: {
    name: 'Google Dialogflow CX',
    provider: 'Google',
    features: {
      intentResolution: true,
      intentConfidenceScore: true,
      audioInput: true,
      testCaseGeneration: true,
      testCaseExport: true,
      supportedFileExtensions: ['.wav', '.pcm', '.m4a', '.flac', '.riff', '.wma', '.aac', '.ogg', '.oga', '.mp3', '.amr']
    },
    helperText: 'You have to download your <a href="https://cloud.google.com/docs/authentication/getting-started" target="_blank">Google credentials</a> for accessing your Dialogflow CX Agent first. The IAM roles <em>Dialogflow API-Administrator</em> and <em>Dialogflow API-Client</em> are required. Project Id, Agent Id and Location can be found in the <a href="https://cloud.google.com/dialogflow/cx/docs/quick/api" target="_blank">Dialogflow CX Console</a>.',
    capabilities: [
      {
        name: 'DIALOGFLOWCX_AUTH_MODE',
        label: 'Authentication Mode',
        description: 'Determines the authentication method to use.',
        type: 'string',
        required: true,
        advanced: false
      },
      {
        name: 'DIALOGFLOWCX_REFRESH_TOKEN',
        label: 'OAuth2 Refresh Token',
        description: 'OAuth2 Refresh Token. Generated via OAuth2 authentication flow.',
        type: 'string',
        advanced: true
      },
      {
        name: 'DIALOGFLOWCX_CLIENT_ID',
        label: 'OAuth2 Client Id',
        description: 'OAuth2 Client Id.',
        type: 'string',
        advanced: true
      },
      {
        name: 'DIALOGFLOWCX_CLIENT_SECRET',
        label: 'OAuth2 Client Secret',
        description: 'OAuth2 Client Secret.',
        type: 'string',
        advanced: true
      },
      {
        name: 'DIALOGFLOWCX_CLIENT_EMAIL',
        label: 'Credentials Client Email',
        description: 'You can find this in the Google Cloud credentials file',
        type: 'string',
        advanced: false
      },
      {
        name: 'DIALOGFLOWCX_PRIVATE_KEY',
        label: 'Credentials Private Key',
        description: 'You can find this in the Google Cloud credentials file',
        type: 'secret',
        advanced: false
      },
      {
        name: 'DIALOGFLOWCX_EXTRACT_TEST_COVERAGE',
        label: 'Extract Test Coverage',
        description: 'Extra requests are required. (Slower test, extra cost on Dialogflow CX side possible, extra permissions)',
        type: 'boolean',
        advanced: true
      },
      {
        name: 'DIALOGFLOWCX_LOCATION',
        label: 'Location',
        description: 'You can find this in the Dialogflow CX Console',
        type: 'choice',
        choices: [
          { name: 'Global', key: 'global' },
          { name: 'us-central1 (Americas/Iowa)', key: 'us-central1' },
          { name: 'northamerica-northeast1 (Americas/Montréal)', key: 'northamerica-northeast1' },
          { name: 'us-east1 (Americas/South Carolina)', key: 'us-east1' },
          { name: 'us-west1 (Americas/Oregon)', key: 'us-west1' },
          { name: 'europe-west1 (Europe/Belgium)', key: 'europe-west1' },
          { name: 'europe-west2 (Europe/London)', key: 'europe-west2' },
          { name: 'europe-west3 (Europe/Frankfurt)', key: 'europe-west3' },
          { name: 'australia-southeast1 (Asia Pacific/Sydney)', key: 'australia-southeast1' },
          { name: 'asia-northeast1 (Asia Pacific/Tokyo)', key: 'asia-northeast1' },
          { name: 'asia-south1 (Asia Pacific/Mumbai)', key: 'asia-south1' },
          { name: 'asia-southeast1 (Asia Pacific/Singapore)', key: 'asia-southeast1' }
        ],
        required: false,
        advanced: false
      },
      {
        name: 'DIALOGFLOWCX_PROJECT_ID',
        label: 'Project Id',
        description: 'You can find this in the Dialogflow CX Console',
        type: 'string',
        required: true,
        advanced: false
      },
      {
        name: 'DIALOGFLOWCX_AGENT_ID',
        label: 'Agent Id',
        description: 'You can find this in the Dialogflow CX Console',
        type: 'query',
        required: true,
        advanced: false,
        query: async (caps) => {
          if (caps && caps.DIALOGFLOWCX_CLIENT_EMAIL && caps.DIALOGFLOWCX_PRIVATE_KEY && caps.DIALOGFLOWCX_PROJECT_ID) {
            try {
              const agentsOpts = {
                projectId: caps.DIALOGFLOWCX_PROJECT_ID,
                credentials: {
                  client_email: caps.DIALOGFLOWCX_CLIENT_EMAIL,
                  private_key: caps.DIALOGFLOWCX_PRIVATE_KEY
                }
              }
              if (caps.DIALOGFLOWCX_LOCATION) {
                agentsOpts.apiEndpoint = `${caps.DIALOGFLOWCX_LOCATION}-dialogflow.googleapis.com`
              }
              const agentsClient = new AgentsClient(agentsOpts)
              const agents = await agentsClient.listAgents({ parent: agentsClient.locationPath(caps.DIALOGFLOWCX_PROJECT_ID, caps.DIALOGFLOWCX_LOCATION) })
              if (agents && agents.length > 0) {
                return agents[0].map(a => ({ name: a.displayName, key: agentsClient.matchAgentFromAgentName(a.name) }))
              }
            } catch (err) {
              throw new Error(`Dialogflow CX Agents Query failed: ${err.message}`)
            }
          }
        }
      },
      {
        name: 'DIALOGFLOWCX_ENVIRONMENT',
        label: 'Environment',
        description: 'Dialogflow publishing environment Id',
        type: 'query',
        required: false,
        advanced: true,
        query: async (caps) => {
          if (caps && caps.DIALOGFLOWCX_CLIENT_EMAIL && caps.DIALOGFLOWCX_PRIVATE_KEY && caps.DIALOGFLOWCX_PROJECT_ID && caps.DIALOGFLOWCX_AGENT_ID) {
            try {
              const envsOpts = {
                projectId: caps.DIALOGFLOWCX_PROJECT_ID,
                credentials: {
                  client_email: caps.DIALOGFLOWCX_CLIENT_EMAIL,
                  private_key: caps.DIALOGFLOWCX_PRIVATE_KEY
                }
              }
              if (caps.DIALOGFLOWCX_LOCATION) {
                envsOpts.apiEndpoint = `${caps.DIALOGFLOWCX_LOCATION}-dialogflow.googleapis.com`
              }
              const envsClient = new EnvironmentsClient(envsOpts)
              const envs = await envsClient.listEnvironments({ parent: envsClient.agentPath(caps.DIALOGFLOWCX_PROJECT_ID, caps.DIALOGFLOWCX_LOCATION || 'global', caps.DIALOGFLOWCX_AGENT_ID) })
              if (envs && envs.length > 0) {
                return envs[0].map(e => ({ name: e.displayName, key: envsClient.matchEnvironmentFromEnvironmentName(e.name) }))
              }
            } catch (err) {
              throw new Error(`Dialogflow CX Agents Query failed: ${err.message}`)
            }
          }
        }
      },
      {
        name: 'DIALOGFLOWCX_LANGUAGE_CODE',
        label: 'Language Code',
        type: 'query',
        required: false,
        advanced: true,
        query: async (caps) => {
          if (caps && caps.DIALOGFLOWCX_CLIENT_EMAIL && caps.DIALOGFLOWCX_PRIVATE_KEY && caps.DIALOGFLOWCX_PROJECT_ID && caps.DIALOGFLOWCX_AGENT_ID) {
            try {
              const agentsOpts = {
                projectId: caps.DIALOGFLOWCX_PROJECT_ID,
                credentials: {
                  client_email: caps.DIALOGFLOWCX_CLIENT_EMAIL,
                  private_key: caps.DIALOGFLOWCX_PRIVATE_KEY
                }
              }
              if (caps.DIALOGFLOWCX_LOCATION) {
                agentsOpts.apiEndpoint = `${caps.DIALOGFLOWCX_LOCATION}-dialogflow.googleapis.com`
              }
              const agentsClient = new AgentsClient(agentsOpts)
              const agents = await agentsClient.getAgent({ name: agentsClient.agentPath(caps.DIALOGFLOWCX_PROJECT_ID, caps.DIALOGFLOWCX_LOCATION, caps.DIALOGFLOWCX_AGENT_ID) })
              if (agents && agents.length > 0) {
                return _.uniq([agents[0].defaultLanguageCode, ...agents[0].supportedLanguageCodes]).map(l => ({ name: l, key: l }))
              }
            } catch (err) {
              throw new Error(`Dialogflow CX Agents Query failed: ${err.message}`)
            }
          }
        }
      },
      {
        name: 'DIALOGFLOWCX_QUERY_PARAMS',
        label: 'Query Parameters',
        type: 'json',
        required: false,
        advanced: true
      },
      {
        name: 'DIALOGFLOWCX_WELCOME_TEXT',
        label: 'Welcome Text',
        description: 'Welcome Text is sent to the Dialogflow CX Agent to initiate the conversation',
        type: 'string',
        required: false,
        advanced: true
      }
    ],
    actions: [
      {
        name: 'GetFlows',
        description: 'Getting flows',
        run: async (caps) => {
          return getFlows({ caps })
        }
      },
      {
        name: 'GetAgentMetaData',
        description: 'GetAgentMetaData',
        run: async (caps) => {
          if (caps && caps.DIALOGFLOWCX_CLIENT_EMAIL && caps.DIALOGFLOWCX_PRIVATE_KEY && caps.DIALOGFLOWCX_PROJECT_ID && caps.DIALOGFLOWCX_AGENT_ID) {
            try {
              const agentsOpts = {
                projectId: caps.DIALOGFLOWCX_PROJECT_ID,
                credentials: {
                  client_email: caps.DIALOGFLOWCX_CLIENT_EMAIL,
                  private_key: caps.DIALOGFLOWCX_PRIVATE_KEY
                }
              }
              if (caps.DIALOGFLOWCX_LOCATION) {
                agentsOpts.apiEndpoint = `${caps.DIALOGFLOWCX_LOCATION}-dialogflow.googleapis.com`
              }
              const agentsClient = new AgentsClient(agentsOpts)
              const agentResponses = await agentsClient.getAgent({ name: agentsClient.agentPath(caps.DIALOGFLOWCX_PROJECT_ID, caps.DIALOGFLOWCX_LOCATION, caps.DIALOGFLOWCX_AGENT_ID) })
              const agentInfo = agentResponses[0]

              return {
                name: agentInfo.displayName,
                description: agentInfo.description,
                metadata: agentInfo
              }
            } catch (err) {
              throw new Error(`Dialogflow CX Agents Query failed: ${err.message}`)
            }
          }
        }
      },
      {
        name: 'GetMetaData',
        description: 'Collects global information about the chatbot state, like version, last change, all cases to test, etc',
        run: async (caps) => {
          if (caps && caps.DIALOGFLOWCX_CLIENT_EMAIL && caps.DIALOGFLOWCX_PRIVATE_KEY && caps.DIALOGFLOWCX_PROJECT_ID && caps.DIALOGFLOWCX_AGENT_ID && caps[Capabilities.DIALOGFLOWCX_EXTRACT_TEST_COVERAGE]) {
            try {
              const limit = pRateLimit({
                interval: 60 * 1000,
                rate: 99,
                concurrency: 10,
                maxDelay: 100000
              })
              const opts = {
                projectId: caps.DIALOGFLOWCX_PROJECT_ID,
                credentials: {
                  client_email: caps.DIALOGFLOWCX_CLIENT_EMAIL,
                  private_key: caps.DIALOGFLOWCX_PRIVATE_KEY
                }
              }
              if (caps.DIALOGFLOWCX_LOCATION) {
                opts.apiEndpoint = `${caps.DIALOGFLOWCX_LOCATION}-dialogflow.googleapis.com`
              }
              const pathToId = (path) => path.substring(path.lastIndexOf('/') + 1)
              const agentsClient = new AgentsClient(opts)
              const agentPath = agentsClient.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
              const [agent] = await limit(() => agentsClient.getAgent({
                name: agentPath
              }))

              const intentsClient = new IntentsClient(opts)
              const intents = await getList(intentsClient, 'listIntents', { parent: agentPath }, limit)
              const intentIdToIntent = {}
              intents.forEach(i => {
                intentIdToIntent[pathToId(i.name)] = {
                  name: i.name,
                  displayName: i.displayName
                }
              })

              const flowsClient = new FlowsClient(opts)
              const flowIdToFlow = {}
              const flowsList = await getList(flowsClient, 'listFlows', { parent: agentPath }, limit)

              const pagesClient = new PagesClient(opts)
              const pageIdToPage = {}
              for (const flow of flowsList) {
                flowIdToFlow[pathToId(flow.name)] = {
                  name: flow.name,
                  displayName: flow.displayName,
                  transitionRoutes: (flow.transitionRoutes || []).map(t => ({
                    intent: t.intent,
                    condition: t.condition,
                    name: t.name,
                    targetFlow: t.targetFlow,
                    targetPage: t.targetPage
                  }))
                }
                const pagesList = await getList(pagesClient, 'listPages', { parent: flow.name }, limit)
                for (const page of pagesList) {
                  pageIdToPage[pathToId(page.name)] = {
                    name: page.name,
                    displayName: page.displayName,
                    transitionRoutes: (page.transitionRoutes || []).map(t => ({
                      intent: t.intent,
                      condition: t.condition,
                      name: t.name,
                      targetFlow: t.targetFlow,
                      targetPage: t.targetPage
                    }))
                  }
                }
              }
              return {
                startFlowId: pathToId(agent.startFlow),
                intentIdToIntent,
                flowIdToFlow,
                pageIdToPage
              }
            } catch (err) {
              throw new Error(`Dialogflow CX Get Metadata Query failed: ${err.message}`)
            }
          }
        }
      }
    ]
  }
}
