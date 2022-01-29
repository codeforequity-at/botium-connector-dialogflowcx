const _ = require('lodash')
const fs = require('fs')
const { AgentsClient, IntentsClient, PagesClient, FlowsClient, protos } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')

const importDialogflowCXIntents = async ({ caps = {}, skipUserWelcomeMessage, maxConversationLength, continueOnDuplicatePage } = { maxConversationLength: 10 }, { statusCallback } = {}) => {
  const status = (log, obj) => {
    if (obj) debug(log, obj)
    else debug(log)
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

    const utterances = []
    const intentIdToIntent = {}
    for (const intent of intents) {
      intentIdToIntent[intent.name] = intent
      const utteranceList = []
      for (const phrase of (intent.trainingPhrases || [])) {
        const utterance = phrase.parts.map(p => p.text).join('').trim()
        if (utteranceList.includes(utterance)) {
          continue
        }
        utteranceList.push(utterance)
      }
      status(`Succesfully extracted intent "${intent.displayName}" utterances: ${utteranceList.length}`)
      if (!utteranceList.length) {
        status(`Ignoring "${intent.displayName}" from utterances because no entry found`)
      } else {
        utterances.push({ name: intent.displayName, utterances: utteranceList })
      }
    }

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

    const storeConvoOptional = (context) => {
      const { conversation, conversations } = context
      const conversationAsString = JSON.stringify(conversation)
      if (conversationAsString && !conversations[conversationAsString]) {
        conversations[conversationAsString] = conversation
        context.conversation = null
      }
    }
    const crawlTransition = async (transitionRoute, context) => {
      const { stack, conversation, conversations } = context
      if (stack.includes(transitionRoute.name)) {
        storeConvoOptional(context)
        status('Route already used, finishing conversation')
        return {}
      }
      if (conversations.length >= maxConversationLength) {
        storeConvoOptional(context)
        status(`Conversation length ${maxConversationLength} reached, finishing conversation`)
        return {}
      }
      stack.push(transitionRoute.name)

      let intent
      if (transitionRoute.intent) {
        const intentStruct = intentIdToIntent[transitionRoute.intent]
        if (intentStruct) {
          intent = intentStruct.displayName
          // /intents/00000000-0000-0000-0000-000000000000 must be the default welcome intent (Always? Better way to decide? Other system intents?)
          // We dont need welcome message for it
          if (!skipUserWelcomeMessage || !transitionRoute.intent.endsWith('/intents/00000000-0000-0000-0000-000000000000')) {
            conversation.push({
              sender: 'me',
              messageText: intent
            })
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
            // console.log(`textMessage ===> ${JSON.stringify(message.text.text)}`)
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
        clonedContext = { ...context, conversation: [...context.conversation] }
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
        clonedContext = { ...context, conversation: [...context.conversation] }
        crawlTransitionResult = (await crawlTransition(transitionRoute, clonedContext)) || {}
      }
    }
    const crawlingContext = { stack: [], conversation: [], conversations: {} }
    status('Crawling conversations')
    await crawlFlow(startFlow, crawlingContext)
    const convos = Object.values(crawlingContext.conversations).map((conversation, i) => ({
      header: {
        name: `Convo ${i}`
      },
      conversation
    }))
    status(`Crawling conversations finished, ${convos.length} conversations found. Crawled ${Object.keys(flowCache).length} flows and ${Object.keys(pageCache).length} pages`)
    return {
      convos,
      utterances
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

const exportDialogflowCXIntents = async ({ caps = {} }, { utterances, convos }, { statusCallback } = {}) => {
  const status = (log, obj) => {
    if (obj) debug(log, obj)
    else debug(log)
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

    let parent
    if (caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]) {
      parent = client.environmentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID], caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT])
    } else {
      parent = client.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
    }
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
      if (newUtterances.length === 0) {
        status(`Writing to intent "${intent}" skipped. There are no user examples to write`)
        continue
      }
      const oldStruct = intents.find(i => i.displayName === intent)
      if (_.isNil(oldStruct)) {
        try {
          await client.createIntent({
            parent,
            intent: {
              displayName: intent,
              languageCode: caps[Capabilities.DIALOGFLOWCX_LANGUAGE_CODE] || null,
              trainingPhrases: newUtterances.map(u => ({ parts: [{ text: u }], repeatCount: 1 }))
            }
          })
        } catch (err) {
          throw new Error(`Dialogflow CX API create intent failed: ${err && err.message}`)
        }
        status(`Writing to intent "${intent}" succesful. Created with ${newUtterances.length} utterances`)
      } else {
        const writeUtterances = newUtterances.filter(u => {
          return !oldStruct.trainingPhrases.find(tp => tp.utterance === u)
        }).map(u => ({ parts: [{ text: u }], repeatCount: 1 }))
        if (writeUtterances.length > 0) {
          oldStruct.trainingPhrases = oldStruct.trainingPhrases.concat(writeUtterances)
          try {
            await client.updateIntent({
              intent: oldStruct
            })
          } catch (err) {
            throw new Error(`Dialogflow CX API update intent failed: ${err && err.message}`)
          }
          status(`Writing to intent "${intent}" succesful. Added ${writeUtterances.length} utterances`)
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

const downloadChatbot = async ({ caps = {} }, { statusCallback } = {}) => {
  const status = (log, obj) => {
    if (obj) debug(log, obj)
    else debug(log)
    if (statusCallback) statusCallback(log, obj)
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

module.exports = {
  importHandler: ({ caps, ...rest } = {}, { statusCallback } = {}) => importDialogflowCXIntents({ caps, ...rest }, { statusCallback }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    }
  },
  exportHandler: ({ caps, ...rest } = {}, { convos, utterances } = {}, { statusCallback } = {}) => exportDialogflowCXIntents({ caps, ...rest }, { convos, utterances }, { statusCallback }),
  exportArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    }
  },
  // not used yet
  downloadChatbot: ({ caps, ...rest } = {}, { statusCallback } = {}) => downloadChatbot({ caps, ...rest }, { statusCallback })
}

const botiumJSON = require('./keybank.json')
importDialogflowCXIntents({ caps: botiumJSON.botium.Capabilities }, { statusCallback: (log, obj) => obj ? console.log(log, obj) : console.log(log) })
