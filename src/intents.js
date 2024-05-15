const crypto = require('crypto')
const fs = require('fs')
const _ = require('lodash')
const { AgentsClient, IntentsClient, PagesClient, FlowsClient, TestCasesClient } = require('@google-cloud/dialogflow-cx')
const { pRateLimit } = require('p-ratelimit')
const { BotDriver } = require('botium-core')
// node-stream-zip uses less memory for working with zip files.
const StreamZip = require('node-stream-zip')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')
const { isCommandPage, getList } = require('./helper')
const { struct } = require('../structJson')
const { downloadChatbot } = require('./api')

const ENTRY_FLOW_ID = '00000000-0000-0000-0000-000000000000'
const ENTRY_FLOW_NAME = `Flow: ${ENTRY_FLOW_ID}`

const importDialogflowCXIntents = ({ ...params }) => {
  params.source = params.source || 'TrainingSetUtteranceIncluded'
  const { source, crawlConvo } = params

  if (source === 'TestSet') {
    return importDialogflowCXIntentsTestSet(params)
  } else {
    if (crawlConvo || source === 'TrainingSetConvo') {
      // legacy mode. Should be removed
      return importDialogflowCXIntentsTrainingSet(params)
    } else {
      return importDialogflowCXIntentsTrainingSetViaDownload(params)
    }
  }
}

const limit = pRateLimit({
  interval: 60 * 1000,
  rate: 99,
  concurrency: 10,
  maxDelay: 100000
})

const nameFromPath = (path) => {
  return path.substring(path.lastIndexOf('/') + 1)
}

const hash = (str) => {
  return crypto.createHash('md5').update(str).digest('hex')
}

const importDialogflowCXIntentsTestSet = async (
  {
    caps = {},
    crawlConvo,
    skipWelcomeMessage,
    maxConversationLength = 10,
    maxFlowsAfterEntryFlow,
    continueOnDuplicatePage,
    continueOnDuplicateFlow,
    flowToCrawl,
    flowToCrawlIncludeForeignUtterances,
    verbose = false
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
  const driver = new BotDriver(caps)
  const container = await driver.Build()

  const testCasesClient = new TestCasesClient(container.pluginInstance.sessionOpts)
  status('Connected to Dialogflow CX TestCases Client')

  const agentPath = testCasesClient.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
  const testCases = await getList(testCasesClient, 'listTestCases', { parent: agentPath, pageSize: 20, view: 'FULL' }, limit)

  const convos = testCases.map(testCase => {
    let externalId = nameFromPath(testCase.name).split('_').join()
    // it should happen never, but to be sure
    if (externalId.length > 32) {
      externalId = hash(externalId)
    }
    const result = {
      header: {
        name: testCase.displayName,
        externalId
      },
      conversation: []
    }

    testCase.testCaseConversationTurns.forEach(turn => {
      if (!turn.userInput && !turn.virtualAgentOutput) {
        status(`Illegal message format : ${JSON.stringify(turn)} in test ${testCase.displayName}`)
        return
      }
      if (turn.userInput) {
        const meMsg = {
          sender: 'me'
        }
        const { input, injectedParameters, isWebhookEnabled, enableSentimentAnalysis } = turn.userInput
        const { text, intent, audio, event, dtmf } = input || {}
        if (text) {
          meMsg.messageText = text.text || ''
        } else if (event && event.event) {
          meMsg.buttons = [{ payload: event.event }]
        } else if (intent || audio || dtmf) {
          status(`Not supported : ${intent ? 'intent' : audio ? 'audio' : 'dtmf'} message of the test "${testCase.displayName}"`)
        } else {
          status(`Empty response in the test ${testCase.displayName}`)
        }
        const queryParams = {}
        if (injectedParameters) {
          const parsed = struct.decode(injectedParameters)
          if (Object.keys(parsed).length) {
            queryParams.parameters = parsed
          }
        }
        if (!isWebhookEnabled) {
          queryParams.disableWebhook = true
        }
        if (enableSentimentAnalysis) {
          queryParams.analyzeQueryTextSentiment = true
        }
        if (Object.keys(queryParams).length) {
          meMsg.logicHooks = [
            {
              name: 'UPDATE_CUSTOM',
              args: ['SET_DIALOGFLOWCX_QUERYPARAMS', JSON.stringify(queryParams)]
            }
          ]
        }

        result.conversation.push(meMsg)
      }
      if (turn.virtualAgentOutput) {
        const botMsg = {
          sender: 'bot'
        }
        const { intent, textResponses } = turn.virtualAgentOutput
        if (intent) {
          botMsg.asserters = [
            {
              name: 'INTENT',
              args: [intent]
            }
          ]
        }
        if (textResponses && textResponses.length) {
          for (const textResponse of textResponses) {
            result.conversation.push(Object.assign({ messageText: textResponse.text }, botMsg))
          }
        } else {
          result.conversation.push(botMsg)
        }
      }
    })
    return result
  })

  return { convos }
}

// plan is to use downloader for the crawler in importDialogflowCXIntentsTrainingSetViaDownload,
// and delete this function
const importDialogflowCXIntentsTrainingSet = async (
  {
    caps = {},
    source,
    crawlConvo,
    skipWelcomeMessage,
    maxConversationLength = 10,
    maxFlowsAfterEntryFlow,
    continueOnDuplicatePage,
    continueOnDuplicateFlow,
    flowToCrawl,
    flowToCrawlIncludeForeignUtterances,
    verbose = false
  } = {},
  {
    statusCallback
  } = {}
) => {
  if (source === 'TrainingSetConvo') {
    crawlConvo = true
  }
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
    status(`Starting download from Dialogflow CX Intets Client ${JSON.stringify({
      source,
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

    const [intents] = await limit(() => intentsClient.listIntents({
      parent: agentPath,
      languageCode: caps[Capabilities.DIALOGFLOWCX_LANGUAGE_CODE] || undefined,
      pageSize: 1000
    }))

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
          include: !crawlConvo
        }
      }
    }
    status(`Succesfully extracted ${Object.keys(utterances).length} utterances`)

    let convos = []
    if (crawlConvo) {
      const crawlConversations = async () => {
        let eventHandlersOnetimeOnlyMessageDone = false
        let onFinishCounter = 0
        try {
          const agentsClient = new AgentsClient(container.pluginInstance.sessionOpts)
          status('Connected to Dialogflow CX Agents Client')
          const flowsClient = new FlowsClient(container.pluginInstance.sessionOpts)
          status('Connected to Dialogflow CX Flows Client')
          const pagesClient = new PagesClient(container.pluginInstance.sessionOpts)
          status('Connected to Dialogflow CX Pages Client')
          const [agent] = await limit(() => agentsClient.getAgent({
            name: agentPath
          }))
          const startFlow = agent.startFlow

          const flowCache = {}
          const pageCache = {}
          let shortestConvoToTartgetFlow = Number.MAX_SAFE_INTEGER
          let conversations = []
          const onFinish = (context, finishedReason, options = {}) => {
            if (context.finishedReasons[finishedReason]) {
              context.finishedReasons[finishedReason]++
            } else {
              context.finishedReasons[finishedReason] = 1
            }
            verbose && status(process.memoryUsage())
            onFinishCounter++
            if (verbose || !options.supressLog) {
              status(finishedReason)
            }
            const { conversation, crawlingTargetFlow, intents, stack } = context
            context.visitedFlow = null
            context.visitedPage = null
            context.visitedTransition = null
            context.conversation = null
            context.intents = null
            if (flowToCrawl && !crawlingTargetFlow) {
              return
            }
            const intentsAsString = JSON.stringify(intents)
            const alreadyThere = conversations.find(c => c.intentsAsString === intentsAsString)
            if (!alreadyThere) {
              verbose && status(`Accepted: ${JSON.stringify({ mine: context.stack })}`)
              conversations.push({ conversation, intents, intentsAsString, finishedReason, stack })
              if (conversations.length % 10 === 0) {
                status(`${conversations.length} conversations processed`)
              }
            } else {
              verbose && status(`Dropped: ${JSON.stringify({ mine: context.stack, theirs: alreadyThere.stack })}`)
              if ((onFinishCounter.length - conversations.length) % 50 === 0) {
                status(`${onFinishCounter - conversations} conversations skipped`)
              }
            }
          }
          const crawlTransitions = async (transitionRoutes, context) => {
            let crawlTransitionResult = {}
            let clonedContext = null

            // speedup try. In many cases clone is not required, because transactionRoute is not useful, we wont go deeper
            const effectiveTransactionRoutes = transitionRoutes.filter((transitionRoute) => {
              if (transitionRoute.intent) {
                return true
              }
              if (transitionRoute.triggerFulfillment && transitionRoute.triggerFulfillment.messages && transitionRoute.triggerFulfillment.messages.length) {
                return true
              }
              if (transitionRoute.targetFlow && transitionRoute.targetFlow.endsWith(ENTRY_FLOW_ID)) {
                return false
              }
              if (transitionRoute.targetPage && isPageToFinish(transitionRoute.targetPage, context)) {
                return false
              }

              return true
            })
            if (effectiveTransactionRoutes.length === 0) {
              onFinish(context, 'All transactions skipped', { supressLog: true })
              return
            }
            for (const transitionRoute of effectiveTransactionRoutes) {
              if (crawlTransitionResult.continueConversation) {
                context = clonedContext
              }
              clonedContext = {
                // flow, and page has to be unique per convo?
                visitedFlow: _.cloneDeep(context.visitedFlow),
                visitedPage: _.cloneDeep(context.visitedPage),
                // transition unique global
                // otherwise we got stack overflow. :)
                // so it is just a performance decision
                visitedTransition: context.visitedTransition,
                conversation: _.cloneDeep(context.conversation),
                intents: _.cloneDeep(context.intents),
                crawlingTargetFlow: context.crawlingTargetFlow,
                stack: context.stack ? _.cloneDeep(context.stack) : null,
                finishedReasons: context.finishedReasons
              }
              crawlTransitionResult = (await crawlTransition(transitionRoute, clonedContext)) || {}
            }
          }
          const crawlTransition = async (transitionRoute, context) => {
            const transitionName = `Transition: ${nameFromPath(transitionRoute.name)}`
            const { visitedTransition, conversation, crawlingTargetFlow, intents, stack } = context
            if (visitedTransition.includes(transitionName)) {
              onFinish(context, 'Route already used, finishing conversation', { supressLog: true })
              return {}
            }
            // teoretically this will be always true. It is already checked before
            if (Object.keys(conversation).length >= maxConversationLength) {
              onFinish(context, `Conversation length ${maxConversationLength} reached, finishing conversation`, { supressLog: true })
              return {}
            }

            visitedTransition.push(transitionName)
            stack && stack.push(transitionName)

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
            if (Object.keys(conversation).length >= maxConversationLength) {
              onFinish(context, `Conversation length ${maxConversationLength} reached, finishing conversation`, { supressLog: true })
              return {}
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
          const isPageToFinish = (pagePath) => {
            return isCommandPage(pagePath)
          }
          const crawlPage = async (pagePath, context) => {
            const pageName = `Page: ${pagePath.substring(pagePath.lastIndexOf('/'))}`
            const { visitedPage, stack } = context
            if (visitedPage.includes(pageName) && !continueOnDuplicatePage) {
              onFinish(context, 'Page already used, finishing conversation', { supressLog: true })
              return {}
            }
            visitedPage.push(pageName)
            stack && stack.push(pageName)

            if (isPageToFinish(pagePath, context)) {
              onFinish(context, `Conversation ended, ${pagePath.substring(pagePath.lastIndexOf('/') + 1)} detected`, { supressLog: true })
              return
            }
            if (!pageCache[pagePath]) {
              try {
                const [page] = await limit(() => pagesClient.getPage({
                  name: pagePath
                }))
                status(`Page #${Object.keys(pageCache).length + 1} read ${page.displayName}`)
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
            if (eventHandlers && eventHandlers.length && !eventHandlersOnetimeOnlyMessageDone) {
              // we have to crawl them too?
              status(`Event handlers detected in page ${displayName} in path ${pagePath} (one time only message)`)
              eventHandlersOnetimeOnlyMessageDone = true
            }

            await crawlTransitions(transitionRoutes, context)
          }
          const crawlFlow = async (flowPath, context) => {
            const flowName = `Flow: ${nameFromPath(flowPath)}`
            if (context.visitedFlow.includes(flowName) && !continueOnDuplicateFlow) {
              onFinish(context, 'Flow already used, finishing conversation', { supressLog: true })
              return {}
            }
            if (maxFlowsAfterEntryFlow && context.visitedFlow.includes(ENTRY_FLOW_NAME) && !context.visitedFlow.includes(flowName) && context.visitedFlow.filter(e => e.startsWith('Flow: ')).length - 1 > maxFlowsAfterEntryFlow) {
              onFinish(context, `Flow crawling is limited to ${maxFlowsAfterEntryFlow}`, { supressLog: true })
              return {}
            }

            if (!flowCache[flowPath]) {
              try {
                const [flow] = await limit(() => flowsClient.getFlow({
                  name: flowPath
                }))
                status(`Flow #${Object.keys(flowCache).length + 1} read ${flowPath}`)
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
            context.visitedFlow.push(flowName)
            context.stack && context.stack.push(flowName)
            if (eventHandlers && eventHandlers.length && !eventHandlersOnetimeOnlyMessageDone) {
              // we have to crawl them too?
              status(`Event handlers detected in flow ${displayName} in path ${flowPath} (one time only message)`)
              eventHandlersOnetimeOnlyMessageDone = true
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
            visitedFlow: [],
            visitedPage: [],
            visitedTransition: [],
            conversation: [],
            intents: [],
            crawlingTargetFlow: false,
            // debug things
            stack: verbose ? [] : null,
            finishedReasons: {}
          }
          status('Crawling conversations')
          await crawlFlow(startFlow, crawlingContext)
          status(`Crawling conversations finished, ${conversations.length} conversations found. Crawled ${Object.keys(flowCache).length} flows and ${Object.keys(pageCache).length} pages`)
          status(`FinishedReasons ${JSON.stringify(crawlingContext.finishedReasons, null, 2)}`)
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
          name: `Convo ${`${i + 1}`.padStart(`${conversations.length}`.length, '0')}`,
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

const importDialogflowCXIntentsTrainingSetViaDownload = async (
  {
    caps = {},
    source,
    googleCloudStorage,
    workdir,
    crawlConvo,
    skipWelcomeMessage,
    maxConversationLength = 10,
    maxFlowsAfterEntryFlow,
    continueOnDuplicatePage,
    continueOnDuplicateFlow,
    flowToCrawl,
    flowToCrawlIncludeForeignUtterances,
    verbose = false
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

  const driver = new BotDriver(caps)
  let container = await driver.Build()

  let zipName
  let zip
  try {
    status(`Starting download from Dialogflow CX Intets Client ${JSON.stringify({
      source,
      crawlConvo,
      workdir,
      skipWelcomeMessage,
      maxConversationLength,
      continueOnDuplicatePage,
      continueOnDuplicateFlow,
      flowToCrawl,
      flowToCrawlIncludeForeignUtterances
    })}`)

    // we need the zip to have env specific intents and flows
    zipName = await downloadChatbot({ caps, googleCloudStorage, workdir, status })
    // eslint-disable-next-line new-cap
    zip = new StreamZip.async({ file: zipName })
    const agent = JSON.parse((await zip.entryData('agent.json')).toString('utf8'))
    const languageCode = caps[Capabilities.DIALOGFLOWCX_LANGUAGE_CODE] || agent.defaultLanguageCode

    let intentTemp = {}

    const entries = await zip.entries()
    for (const entry of Object.values(entries).filter(e => e.name.startsWith('intents/') && e.name.endsWith('.json'))) {
      const path = entry.name.split('/')
      const nameFromPath = path[1]
      if (!intentTemp[nameFromPath]) {
        intentTemp[nameFromPath] = {}
      }
      const json = JSON.parse((await zip.entryData(entry.name)).toString('utf8'))
      if (path.length === 4 && path[2] === 'trainingPhrases') {
        // intents/GREETING/trainingPhrases/en.json
        const entryLanguageCode = path[3].substring(0, path[3].length - '.json'.length)
        if (!intentTemp[nameFromPath].trainingPhrases || languageCode.startsWith(entryLanguageCode)) {
          intentTemp[nameFromPath].trainingPhrases = json.trainingPhrases
        }
      } else if (path.length === 3) {
        intentTemp[nameFromPath].name = json.name
        intentTemp[nameFromPath].displayName = json.displayName
      } else {
        status(`Unknown file in downloaded zip ${entry.name}`)
      }
    }

    const utterances = {}
    for (const intent of Object.values(intentTemp)) {
      const utteranceList = []
      for (const phrase of (intent.trainingPhrases || [])) {
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
        let externalId = intent.name.split('_').join()
        // it should happen never, but to be sure
        if (externalId.length > 32) {
          externalId = hash(externalId)
        }
        utterances[intent.displayName] = {
          name: intent.displayName,
          externalId,
          utterances: utteranceList,
          include: source === 'TrainingSetUtterance'
        }
      }
    }
    intentTemp = null
    status(`Succesfully extracted ${Object.keys(utterances).length} utterances`)

    if (source !== 'TrainingSetUtterance') {
      for (const entry of Object.values(entries).filter(e => e.name.startsWith('flows/') && e.name.endsWith('.json'))) {
        try {
          const json = JSON.parse((await zip.entryData(entry.name)).toString('utf8'))
          if (json.transitionRoutes) {
            for (const t of json.transitionRoutes) {
              if (t.intent) {
                utterances[t.intent].include = true
              }
            }
          }
        } catch (err) {
          status(`Failed to process: ${entry.name}: ${err.message || err}`)
        }
      }
    }
    zip.close()
    zip = null
    fs.rmSync(zipName, { force: true })
    zipName = null

    return {
      convos: [],
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
      container = null
    }
    if (zip) {
      try {
        zip.close()
      } catch (err) {
        debug(`Error zip cleanup: ${err && err.message}`)
      }
      zip = null
    }
    if (zipName) {
      fs.rmSync(zipName, { force: true })
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
  importHandler: ({ caps, source, googleCloudStorage, workdir, crawlConvo, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, continueOnDuplicateFlow, flowToCrawl, flowToCrawlIncludeForeignUtterances, maxFlowsAfterEntryFlow, ...rest } = {}, { statusCallback } = {}) => importDialogflowCXIntents({ caps, source, crawlConvo, googleCloudStorage, workdir, skipWelcomeMessage, maxConversationLength, continueOnDuplicatePage, continueOnDuplicateFlow, flowToCrawl, flowToCrawlIncludeForeignUtterances, maxFlowsAfterEntryFlow, ...rest }, { statusCallback }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    source: {
      describe: 'Source to download from',
      choices: [/* crawl convo and utterances. Old scool, remove this prop */'TrainingSet', /* currently same as TrainingSet */ 'TrainingSetConvo', 'TrainingSetUtterance', 'TrainingSetUtteranceIncluded', 'TestSet'],
      default: 'TrainingSetUtteranceIncluded'
    },
    googleCloudStorage: {
      describe: 'Google cloud storage to store the chatbot export.',
      type: 'string'
    },
    workdir: {
      describe: 'Directory for temporary files',
      type: 'string'
    },
    // works just for TrainingSet mode. so this flag should be removed, and covered via a new source entry
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
