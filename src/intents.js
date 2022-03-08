const crypto = require('crypto')
const _ = require('lodash')
const { AgentsClient, IntentsClient, PagesClient, FlowsClient } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')
const ENTRY_FLOW_NAME = 'Flow: 00000000-0000-0000-0000-000000000000'

const importDialogflowCXIntents = async (
  {
    caps = {},
    crawlConvo,
    skipWelcomeMessage,
    maxConversationLength = 10,
    maxFlowsAfterEntryFlow,
    continueOnDuplicatePage,
    continueOnDuplicateFlow,
    flowToCrawl,
    flowToCrawlIncludeForeignUtterances
  } = {},
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
  const nameFromPath = (path) => {
    return path.substring(path.lastIndexOf('/') + 1)
  }
  const hash = (str) => {
    return crypto.createHash('md5').update(str).digest('hex')
  }

  const driver = new BotDriver(caps)
  const container = await driver.Build()

  try {
    status(`Starting download from Dialogflow CX Intets Client ${JSON.stringify({
      crawlConvo,
      skipWelcomeMessage,
      maxConversationLength,
      continueOnDuplicatePage,
      continueOnDuplicateFlow,
      flowToCrawl,
      flowToCrawlIncludeForeignUtterances
    })}`)
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
        if (phrase.parts.filter(p => p.parameterId).length > 0) {
          // TODO
          console.log(`phrase ===> ${JSON.stringify(phrase)}`)
        }
        phrase.utterance = phrase.parts.map(p => p.text).join('').trim()
        if (!utteranceList.includes(phrase.utterance)) {
          utteranceList.push(phrase.utterance)
        }
      }
      if (!utteranceList.length) {
        status(`Ignoring "${intent.displayName}" from utterances because no entry found`)
      } else {
        // max length of the externalId is 32.
        // it looks name without '_' is exactly 32 length
        let externalId = nameFromPath(intent.name).split('_').join()
        // it should happen never, but to be sure
        if (externalId.length > 32) {
          externalId = hash(externalId)
        }
        utterances[intent.displayName] = {
          name: intent.displayName,
          externalId,
          utterances: utteranceList,
          include: !flowToCrawl || !crawlConvo
        }
      }
    }
    status(`Succesfully extracted ${Object.keys(utterances).length} utterances`)

    let convos = []
    if (crawlConvo) {
      const crawlConversations = async () => {
        try {
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
          let conversations = []
          const onFinish = (context, finishedReason, options = {}) => {
            if (!options.supressLog) {
              status(finishedReason)
            }
            const { conversation, crawlingTargetFlow, intents } = context
            if (flowToCrawl && !crawlingTargetFlow) {
              return
            }
            const intentsAsString = JSON.stringify(intents)
            if (!conversations.find(c => c.intentsAsString === intentsAsString)) {
              conversations.push({ conversation, intents, intentsAsString, finishedReason })
            }
            context.conversation = null
            context.intents = null
          }
          const crawlTransitions = async (transitionRoutes, context) => {
            let crawlTransitionResult = {}
            let clonedContext = null
            for (const transitionRoute of transitionRoutes) {
              if (crawlTransitionResult.continueConversation) {
                context = clonedContext
              }
              clonedContext = _.cloneDeep(context)
              crawlTransitionResult = (await crawlTransition(transitionRoute, clonedContext)) || {}
            }
          }
          const crawlTransition = async (transitionRoute, context) => {
            const transitionName = `Transition: ${nameFromPath(transitionRoute.name)}`
            const { visited, conversation, crawlingTargetFlow, intents } = context
            if (visited.includes(transitionName)) {
              onFinish(context, 'Route already used, finishing conversation')
              return {}
            }
            if (Object.keys(conversation).length >= maxConversationLength) {
              onFinish(context, `Conversation length ${maxConversationLength} reached, finishing conversation`, { supressLog: true })
              return {}
            }

            visited.push(transitionName)

            let intent

            if (transitionRoute.intent) {
              const intentStruct = intentIdToDialogflowIntent[transitionRoute.intent]
              if (intentStruct) {
                intents.push(nameFromPath(intentStruct.name))
                intent = intentStruct.displayName
                if (intentStruct.trainingPhrases.length === 0) {
                  onFinish(context, `Intent ${intent} without user examples reached. Can't continue conversation`)
                  return {}
                }
                // /intents/00000000-0000-0000-0000-000000000000 must be the default welcome intent (Always? Better way to decide? Other system intents?)
                // We dont need welcome message for it
                if (!skipWelcomeMessage || !transitionRoute.intent.endsWith('/intents/00000000-0000-0000-0000-000000000000')) {
                  if (!flowToCrawl || crawlingTargetFlow || flowToCrawlIncludeForeignUtterances) {
                    // if (crawlingTargetFlow || flowToCrawlIncludeForeignUtterances) {
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
                // variables like "$session.params.type_of_doctor" to "*"
                botMessage.messageText = botMessageText.replace(/\$session\.params\.[A-Za-z_-]+/gm, '*')
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
            if (!crawlingTargetFlow && shortestConvoToTartgetFlow < conversation.length) {
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
                // do we need onFinish here?
                return {}
              }
            }
          }
          const crawlPage = async (pagePath, context) => {
            const { visited } = context
            if (visited.includes(pagePath) && !continueOnDuplicatePage) {
              onFinish(context, 'Page already used, finishing conversation')
              return {}
            }
            visited.push(pagePath)
            if (pagePath.endsWith('/pages/END_SESSION') || pagePath.endsWith('/pages/PREVIOUS_PAGE') || pagePath.endsWith('/pages/CURRENT_PAGE')) {
              onFinish(context, `Conversation ended, ${pagePath.substring(pagePath.lastIndexOf('/') + 1)} detected`)
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
                status(`Failed to get page: ${pagePath}: ${err.message || err}`)
                throw new Error(`Failed to get page: ${pagePath}: ${err.message || err}`)
              }
            }
            const { transitionRoutes, eventHandlers, displayName } = pageCache[pagePath]
            if (eventHandlers && eventHandlers.length) {
            // we have to crawl them too?
              status(`Event handlers detected in page ${displayName} in path ${pagePath}`)
            }

            await crawlTransitions(transitionRoutes, context)
          }
          const crawlFlow = async (flowPath, context) => {
            const flowName = `Flow: ${nameFromPath(flowPath)}`
            if (context.visited.includes(flowName) && !continueOnDuplicateFlow) {
              onFinish(context, 'Flow already used, finishing conversation')
              return {}
            }
            if (maxFlowsAfterEntryFlow && context.visited.includes(ENTRY_FLOW_NAME) && !context.visited.includes(flowName) && context.visited.filter(e => e.startsWith('Flow: ')).length - 1 > maxFlowsAfterEntryFlow) {
              onFinish(context, `Flow crawling is limited to ${maxFlowsAfterEntryFlow}`)
              return {}
            }

            if (!flowCache[flowPath]) {
              try {
                const [flow] = await flowsClient.getFlow({
                  name: flowPath
                })
                flowCache[flowPath] = flow
              } catch (err) {
                status(`Failed to get flow: ${flowPath}: ${err.message || err}`)
                throw new Error(`Failed to get flow: ${flowPath}: ${err.message || err}`)
              }
            }

            const { transitionRoutes, eventHandlers, displayName } = flowCache[flowPath]
            if (flowToCrawl) {
              if (flowPath === flowToCrawl) {
                if (context.crawlingTargetFlow) {
                  status('Started crawling target flow multiple times. It points to himself somehow?')
                } else {
                  const conversationLength = context.conversation.length
                  // teoretically the current convo has to be terminated before this check
                  if (shortestConvoToTartgetFlow < conversationLength) {
                    return
                  } else if (shortestConvoToTartgetFlow > conversationLength) {
                    shortestConvoToTartgetFlow = conversationLength
                    // delete all previous conversations, because they have too long entry path to the target flow
                    conversations = []
                  }
                }
                context.crawlingTargetFlow = true
              } else {
                if (context.crawlingTargetFlow) {
                  onFinish(context, `Conversation ended, conversation tries to leave target flow to flow ${displayName}`)
                  return
                }
              }
            }
            context.visited.push(flowName)
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

            await crawlTransitions(transitionRoutes, context)
          }
          const crawlingContext = {
            visited: [],
            conversation: [],
            intents: [],
            crawlingTargetFlow: false
          }
          status('Crawling conversations')
          await crawlFlow(startFlow, crawlingContext)
          status(`Crawling conversations finished, ${conversations.length} conversations found. Crawled ${Object.keys(flowCache).length} flows and ${Object.keys(pageCache).length} pages`)
          return conversations
        } catch (err) {
          status(`Failed to crawl conversation: ${err}`)
          throw err
        }
      }
      const crawledConvos = await crawlConversations()

      const conversations = crawledConvos.filter((outer, i, conversations) => {
        // filter out convo, if convoX.startsWith(convo)

        const longerConvoExists = conversations.filter((inner, j) => {
          if (i === j) {
            return false
          }

          // intents cant equal. It is checked earlier
          if (inner.intents.length <= outer.intents.length) {
            return false
          }

          for (const k in outer.intents) {
            if (outer.intents[k] !== inner.intents[k]) {
              return false
            }
          }

          return true
        }).length > 0
        return !longerConvoExists
      })

      convos = conversations.map(({ conversation, intents, finishedReason }, i) => ({
        header: {
          name: `Convo ${i}`,
          externalId: hash(JSON.stringify(intents))
        },
        conversation
      }))
    }
    return {
      convos,
      utterances: Object.values(utterances).filter(u => u.include).map(u => ({
        externalId: u.externalId,
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
  importHandler: ({ caps, crawlConvo, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, continueOnDuplicateFlow, flowToCrawl, flowToCrawlIncludeForeignUtterances, maxFlowsAfterEntryFlow, ...rest } = {}, { statusCallback } = {}) => importDialogflowCXIntents({ caps, crawlConvo, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, continueOnDuplicateFlow, flowToCrawl, flowToCrawlIncludeForeignUtterances, maxFlowsAfterEntryFlow, ...rest }, { statusCallback }),
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
      describe: 'The maximal length of the converstion',
      type: 'number',
      default: 10
    },
    continueOnDuplicatePage: {
      describe: 'Continue crawling if a convo appears twice in a conversation',
      type: 'boolean',
      default: false
    },
    flowToCrawl: {
      describe: 'If its set then just a specific flow will be crawled.',
      type: 'string'
    },
    flowToCrawlIncludeForeignUtterances: {
      describe: 'While crawling specific flow extract not just the flow specific utterances',
      type: 'boolean',
      default: false
    },
    maxFlowsAfterEntryFlow: {
      describe: 'The number of crawled flows. Good value is the maximal number of the dependent flows (like for ordering and buying flow of a pizza chatbot)',
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
