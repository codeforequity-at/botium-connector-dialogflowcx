const _ = require('lodash')
const { AgentsClient, IntentsClient, PagesClient, FlowsClient } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')

const importDialogflowCXIntents = async (
  {
    caps = {},
    crawlConvo,
    skipWelcomeMessage,
    maxConversationLength,
    continueOnDuplicatePage,
    flowToCrawl,
    flowToCrawlIncludeForeignUtterances
  } = { maxConversationLength: 10 },
  {
    statusCallback
  } = {}
) => {
  const status = (log, obj) => {
    if (obj) {
      debug(log, obj)
    } else {
      debug(log)
    }
    if (statusCallback) statusCallback(log, obj)
  }

  const driver = new BotDriver(caps)
  const container = await driver.Build()

  try {
    const intentsClient = new IntentsClient(container.pluginInstance.sessionOpts)
    status('Connected to Dialogflow CX Intets Client')

    const agentPath = intentsClient.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
    status(`Using Dialogflow CX project "${agentPath}"`)

    const [intents] = await intentsClient.listIntents({
      parent: agentPath,
      pageSize: 1000
    })

    const utterances = {}
    const intentIdToDialogflowIntent = {}
    for (const intent of intents) {
      intentIdToDialogflowIntent[intent.name] = intent
      const utteranceList = []
      for (const phrase of (intent.trainingPhrases || [])) {
        phrase.utterance = phrase.parts.map(p => p.text).join('').trim()
        if (!utteranceList.includes(phrase.utterance)) {
          utteranceList.push(phrase.utterance)
        }
      }
      status(`Succesfully extracted intent "${intent.displayName}" utterances: ${utteranceList.length}`)
      if (!utteranceList.length) {
        status(`Ignoring "${intent.displayName}" from utterances because no entry found`)
      } else {
        utterances[intent.displayName] = {
          name: intent.displayName,
          utterances: utteranceList,
          include: !flowToCrawl || !crawlConvo
        }
      }
    }

    let conversations = {}
    if (crawlConvo) {
      const crawlConversations = async () => {
        const agentsClient = new AgentsClient(container.pluginInstance.sessionOpts)
        status('Connected to Dialogflow CX Agents Client')
        const flowsClient = new FlowsClient(container.pluginInstance.sessionOpts)
        status('Connected to Dialogflow CX Flows Client')
        const pagesClient = new PagesClient(container.pluginInstance.sessionOpts)
        status('Connected to Dialogflow CX Pages Client')
        const [agent] = await agentsClient.getAgent({
          name: agentPath
        })
        const startFlow = agent.startFlow

        const flowCache = {}
        const pageCache = {}
        let shortestConvoToTartgetFlow = Number.MAX_SAFE_INTEGER
        let conversations = {}
        const storeConvoOptional = (context) => {
          const { conversation, crawlingTargetFlow } = context
          if (flowToCrawl && !crawlingTargetFlow) {
            return
          }
          const conversationAsString = JSON.stringify(conversation)
          if (conversationAsString && !conversations[conversationAsString]) {
            conversations[conversationAsString] = conversation
            context.conversation = null
          }
        }
        const crawlTransition = async (transitionRoute, context) => {
          const { stack, conversation } = context
          if (stack.includes(transitionRoute.name)) {
            storeConvoOptional(context)
            status('Route already used, finishing conversation')
            return {}
          }
          if (Object.keys(conversations).length >= maxConversationLength) {
            storeConvoOptional(context)
            status(`Conversation length ${maxConversationLength} reached, finishing conversation`)
            return {}
          }
          stack.push(transitionRoute.name)

          let intent
          if (transitionRoute.intent) {
            const intentStruct = intentIdToDialogflowIntent[transitionRoute.intent]
            if (intentStruct) {
              intent = intentStruct.displayName
              if (intentStruct.trainingPhrases.length === 0) {
                storeConvoOptional(context)
                status(`Intent ${intent} without user examples reached. Can't continue conversation`)
                return {}
              }
              // /intents/00000000-0000-0000-0000-000000000000 must be the default welcome intent (Always? Better way to decide? Other system intents?)
              // We dont need welcome message for it
              if (!skipWelcomeMessage || !transitionRoute.intent.endsWith('/intents/00000000-0000-0000-0000-000000000000')) {
                if (flowToCrawl || flowToCrawlIncludeForeignUtterances) {
                  conversation.push({
                    sender: 'me',
                    messageText: intent
                  })
                  utterances[intent].include = true
                } else {
                  conversation.push({
                    sender: 'me',
                    messageText: intentStruct.trainingPhrases[0].utterance
                  })
                }
              }
            } else {
              status(`Intent "${transitionRoute.intent}" not found`)
            }
          }

          let botMessageText = ''
          let botResponseExists = false
          if (transitionRoute.triggerFulfillment && transitionRoute.triggerFulfillment.messages && transitionRoute.triggerFulfillment.messages.length) {
            botResponseExists = true
            for (const message of transitionRoute.triggerFulfillment.messages) {
              if (message.text && message.text.text) {
                botMessageText += (botMessageText.length ? '\n' : '') + message.text.text.join(',')
              }
            }
          }

          if (botResponseExists || intent) {
            const botMessage = {
              sender: 'bot'
            }
            if (botMessageText) {
              botMessage.messageText = botMessageText
            }
            if (intent) {
              botMessage.asserters = [
                {
                  name: 'INTENT',
                  args: [intent]
                }
              ]
            }
            conversation.push(botMessage)
          }
          if (!context.crawlingTargetFlow && shortestConvoToTartgetFlow < conversation.length) {
            status('Not reached the target flow using the shortest path. Skipping conversation.')
            return {}
          }

          if (transitionRoute.targetPage) {
            await crawlPage(transitionRoute.targetPage, context)
            return {}
          } else if (transitionRoute.targetFlow) {
            await crawlFlow(transitionRoute.targetFlow, context)
            return {}
          } else {
            if (transitionRoute.condition === 'true') {
              return { continueConversation: true }
            } else {
              if (!transitionRoute.condition && transitionRoute.condition.length) {
                status(`Dont't know what to do now, transition route ${transitionRoute.name} has condition. Fininshing conversation`)
              }
              // we come here via intent, created conversations, and nothing more to do?
              storeConvoOptional(context)
              return {}
            }
          }
        }
        const crawlPage = async (pagePath, context) => {
          const { stack } = context
          if (stack.includes(pagePath) && !continueOnDuplicatePage) {
            storeConvoOptional(context)
            status('Page already used, finishing conversation')
            return {}
          }
          stack.push(pagePath)
          if (pagePath.endsWith('/pages/END_SESSION') || pagePath.endsWith('/pages/PREVIOUS_PAGE')) {
            status(`Conversation ended, ${pagePath.substring(pagePath.lastIndexOf('/') + 1)} detected`)
            storeConvoOptional(context)
            return
          }
          if (!pageCache[pagePath]) {
            try {
              const [page] = await pagesClient.getPage({
                name: pagePath
              })
              pageCache[pagePath] = page
              if (page.form) {
                status(`Form detected in page ${page.displayName}`)
              }
            } catch (err) {
              status(`Conversation ended, failed to get page ${pagePath}: ${err.message || err}`)
              storeConvoOptional(context)
              return
            }
          }
          const { transitionRoutes, eventHandlers, displayName } = pageCache[pagePath]
          if (eventHandlers && eventHandlers.length) {
            // we have to crawl them too?
            status(`Event handlers detected in page ${displayName} in path ${pagePath}`)
          }
          status(`Crawling page "${displayName}" path: ${pagePath}`)

          let crawlTransitionResult = {}
          let clonedContext
          for (const transitionRoute of transitionRoutes) {
            if (crawlTransitionResult.continueConversation) {
              context = clonedContext
            }
            clonedContext = {
              ...context,
              conversation: [...context.conversation]
            }
            crawlTransitionResult = (await crawlTransition(transitionRoute, clonedContext)) || {}
          }
        }
        const crawlFlow = async (flowPath, context) => {
          if (!flowCache[flowPath]) {
            try {
              const [flow] = await flowsClient.getFlow({
                name: flowPath
              })
              flowCache[flowPath] = flow
            } catch (err) {
              status(`Conversation ended, failed to get flow ${flowPath}: ${err.message || err}`)
              storeConvoOptional(context)
              return
            }
          }
          const { transitionRoutes, eventHandlers, displayName } = flowCache[flowPath]
          if (flowToCrawl) {
            if (flowPath === flowToCrawl) {
              if (context.crawlingTargetFlow) {
                status('Started crawling target flow multiple times. It points to himself somehow?')
              } else {
                const conversationLength = Object.keys(conversations).length
                // teoretically the current convo has to be terminated before this check
                if (shortestConvoToTartgetFlow < conversationLength) {
                  return
                } else if (shortestConvoToTartgetFlow > conversationLength) {
                  shortestConvoToTartgetFlow = conversationLength
                  // delete all previous conversations, because they have too long entry path to the target flow
                  conversations = {}
                }
              }
              context.crawlingTargetFlow = true
            } else {
              if (context.crawlingTargetFlow) {
                status(`Conversation ended, conversation tries to leave target flow to flow ${displayName}`)
                storeConvoOptional(context)
                return
              }
            }
          }
          status(`Crawling flow "${displayName}"`)
          if (eventHandlers && eventHandlers.length) {
            // we have to crawl them too?
            status(`Event handlers detected in flow ${displayName} in path ${flowPath}`)
          }
          if (!transitionRoutes || transitionRoutes.length === 0) {
            status(`No transition routes detected in flow ${displayName} in path ${flowPath}`)
            return
          }

          if (transitionRoutes.length > 1) {
            // we have to crawl all of them for sure. but how?
            // in examples the first transition was activated via welcome intent in case of entry flow,
            // or via true on others. Branching via intent is not possible here, the flow itself was choosen via intent
            // and there where no user interactions after.
            // status(`More than one transition route is detected in flow ${displayName} in path ${flowPath}`)
          }

          let crawlTransitionResult = {}
          let clonedContext
          for (const transitionRoute of transitionRoutes) {
            if (crawlTransitionResult.continueConversation) {
              context = clonedContext
            }
            clonedContext = {
              ...context,
              conversation: [...context.conversation]
            }
            crawlTransitionResult = (await crawlTransition(transitionRoute, clonedContext)) || {}
          }
        }
        const crawlingContext = {
          stack: [],
          conversation: []
        }
        status('Crawling conversations')
        await crawlFlow(startFlow, crawlingContext)
        return conversations
      }
      conversations = await crawlConversations()
    }
    const convos = Object.values(conversations).map((conversation, i) => ({
      header: {
        name: `Convo ${i}`
      },
      conversation
    }))
    status(`Crawling conversations finished, ${convos.length} conversations found. Crawled ${Object.keys(flowCache).length} flows and ${Object.keys(pageCache).length} pages`)
    return {
      convos,
      utterances: Object.values(utterances).filter(u => u.include).map(u => ({
        name: u.name,
        utterances: u.utterances
      }))
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

const exportDialogflowCXIntents = async ({ caps = {}, deleteOldUtterances }, { utterances, convos }, { statusCallback } = {}) => {
  const status = (log, obj) => {
    if (obj) {
      debug(log, obj)
    } else {
      debug(log)
    }
    if (statusCallback) statusCallback(log, obj)
  }

  if (!utterances || utterances.length === 0) {
    status('No utterances to export')
    return
  }
  const driver = new BotDriver(caps)
  const container = await driver.Build()

  let intents
  try {
    const client = new IntentsClient(container.pluginInstance.sessionOpts)
    status('Connected to Dialogflow CX')

    const parent = client.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
    try {
      status(`Using Dialogflow CX project "${parent}"`)

      intents = (await client.listIntents({
        parent,
        pageSize: 1000
      }))[0]

      for (const intent of intents) {
        for (const phrase of (intent.trainingPhrases || [])) {
          phrase.utterance = phrase.parts.map(p => p.text).join('').trim()
        }
      }
    } catch (err) {
      throw new Error(`Dialogflow CX API download current intents failed: ${err && err.message}`)
    }

    for (const newStruct of (utterances || [])) {
      const intent = newStruct.name
      const newUtterances = _.uniq(newStruct.utterances || [])
      const oldStruct = intents.find(i => i.displayName === intent)
      if (_.isNil(oldStruct)) {
        try {
          await client.createIntent({
            parent,
            intent: {
              displayName: intent,
              languageCode: caps[Capabilities.DIALOGFLOWCX_LANGUAGE_CODE] || null,
              trainingPhrases: newUtterances.map(u => ({
                parts: [{ text: u }],
                repeatCount: 1
              }))
            }
          })
        } catch (err) {
          throw new Error(`Dialogflow CX API create intent failed: ${err && err.message}`)
        }
        status(`Writing to intent "${intent}" succesful. Created with ${newUtterances.length} utterances`)
      } else {
        const writeUtterances = newUtterances.filter(u => !oldStruct.trainingPhrases.find(tp => tp.utterance === u)).map(u => ({
          parts: [{ text: u }],
          repeatCount: 1
        }))
        let deleteUtterances = oldStruct.trainingPhrases.map(tp => tp.utterance).filter(u => !newUtterances.includes(u))
        if (deleteUtterances.length > 0 && !deleteOldUtterances) {
          status(`Deleting utterances from intent "${intent}" skipped. There are some utterances does not exists locally, but utterance deletion is disabled`)
          deleteUtterances = []
        }
        if (writeUtterances.length > 0 || deleteUtterances.length > 0) {
          oldStruct.trainingPhrases = oldStruct.trainingPhrases.filter(tp => !deleteUtterances.includes(tp.utterance)).concat(writeUtterances)
          try {
            await client.updateIntent({
              intent: oldStruct
            })
          } catch (err) {
            throw new Error(`Dialogflow CX API update intent failed: ${err && err.message}`)
          }
          status(`Writing to intent "${intent}" succesful. Added ${writeUtterances.length} utterances, deleted ${deleteUtterances.length} utterances`)
        } else {
          status(`Writing to intent "${intent}" skipped. No new utterances`)
        }
      }
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

module.exports = {
  importHandler: ({ caps, crawlConvo, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, flowToCrawl, flowToCrawlIncludeForeignUtterances, ...rest } = {}, { statusCallback } = {}) => importDialogflowCXIntents({ caps, crawlConvo, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, flowToCrawl, flowToCrawlIncludeForeignUtterances, ...rest }, { statusCallback }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    crawlConvo: {
      describe: 'Build convo files',
      type: 'boolean',
      default: true
    },
    skipWelcomeMessage: {
      describe: 'Add welcome message to convo files',
      type: 'boolean',
      default: false
    },
    maxConversationLength: {
      describe: 'Path to the exported Dialogflow agent zip file. If not given, it will be downloaded (with connection settings from botium.json).',
      type: 'number',
      default: 10
    },
    continueOnDuplicatePage: {
      describe: 'Path to the exported Dialogflow agent zip file. If not given, it will be downloaded (with connection settings from botium.json).',
      type: 'boolean',
      default: false
    },
    flowToCrawl: {
      describe: 'Path to the exported Dialogflow agent zip file. If not given, it will be downloaded (with connection settings from botium.json).',
      type: 'string'
    },
    flowToCrawlIncludeForeignUtterances: {
      describe: 'Path to the exported Dialogflow agent zip file. If not given, it will be downloaded (with connection settings from botium.json).',
      type: 'boolean',
      default: false
    }
  },
  exportHandler: ({ caps, deleteOldUtterances, ...rest } = {}, { convos, utterances } = {}, { statusCallback } = {}) => exportDialogflowCXIntents({ caps, deleteOldUtterances, ...rest }, {
    convos,
    utterances
  }, { statusCallback }),
  exportArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    deleteOldUtterances: {
      describe: 'Delete old utterances',
      type: 'boolean',
      default: true
    }
  }
}
