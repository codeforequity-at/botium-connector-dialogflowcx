const _ = require('lodash')
const { IntentsClient } = require('@google-cloud/dialogflow-cx')
const { BotDriver } = require('botium-core')
const debug = require('debug')('botium-connector-dialogflowcx-intents')
const Capabilities = require('./Capabilities')

const importDialogflowCXIntents = async ({ caps = {}, buildconvosforutterances, buildconvosforentities = true }, { statusCallback }) => {
  const status = (log, obj) => {
    if (obj) debug(log, obj)
    else debug(log)
    if (statusCallback) statusCallback(log, obj)
  }

  const driver = new BotDriver(caps)
  const container = await driver.Build()

  const client = new IntentsClient(container.pluginInstance.sessionOpts)
  status('Connected to Dialogflow CX', container.pluginInstance.sessionOpts)

  let parent
  if (caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT]) {
    parent = client.environmentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID], caps[Capabilities.DIALOGFLOWCX_ENVIRONMENT])
  } else {
    parent = client.agentPath(caps[Capabilities.DIALOGFLOWCX_PROJECT_ID], caps[Capabilities.DIALOGFLOWCX_LOCATION] || 'global', caps[Capabilities.DIALOGFLOWCX_AGENT_ID])
  }
  status(`Using Dialogflow CX project "${parent}"`)

  const [intents] = await client.listIntents({
    parent,
    pageSize: 1000
  })

  const convos = []
  const utterances = []
  for (const intent of intents) {
    const utteranceList = []
    let convoForEntityExtracted = 0
    let convoForUtteranceExtracted = 0
    for (const phrase of (intent.trainingPhrases || [])) {
      const utterance = phrase.parts.map(p => p.text).join('').trim()
      if (utteranceList.includes(utterance)) {
        continue
      }
      utteranceList.push(utterance)
      const entities = phrase.parts.filter(p => p.parameterId)
      if (buildconvosforentities && entities.length) {
        convoForEntityExtracted++
        const convo = {
          header: {
            name: `${intent.displayName} - ${utterance}`
          },
          conversation: [
            {
              sender: 'me',
              messageText: utterance
            },
            {
              sender: 'bot',
              asserters: [
                {
                  name: 'INTENT',
                  args: [intent.displayName]
                },
                {
                  name: 'ENTITIES',
                  args: entities.map(e => e.parameterId.toLowerCase())
                }
              ]
            }
          ]
        }
        convos.push(convo)
      }
    }
    if (buildconvosforutterances) {
      convoForUtteranceExtracted++
      const convo = {
        header: {
          name: intent.displayName
        },
        conversation: [
          {
            sender: 'me',
            messageText: intent.displayName
          },
          {
            sender: 'bot',
            asserters: [
              {
                name: 'INTENT',
                args: [intent.displayName]
              }
            ]
          }
        ]
      }
      convos.push(convo)
    }
    status(`Succesfully extracted intent "${intent.displayName}" utterances: ${utteranceList.length}, convos for entity asserters: ${convoForEntityExtracted}, convos for intent asserters: ${convoForUtteranceExtracted}`)
    if (!utteranceList.length) {
      status(`Ignoring "${intent.displayName}" from utterances because no entry found`)
    } else {
      utterances.push({ name: intent.displayName, utterances: utteranceList })
    }
  }

  return { convos, utterances }
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
    status('Connected to Dialogflow CX', container.pluginInstance.sessionOpts)

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

module.exports = {
  importHandler: ({ caps, buildconvosforutterances, buildconvosforentities, ...rest } = {}, { statusCallback } = {}) => importDialogflowCXIntents({ caps, buildconvosforutterances, buildconvosforentities, ...rest }, { statusCallback }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    buildconvosforutterances: {
      describe: 'Build convo files for intent assertions per utterance file',
      type: 'boolean',
      default: false
    },
    buildconvosforentities: {
      describe: 'Build convo files for entity assertions per utterance of utterance file, if it has entities',
      type: 'boolean',
      default: true
    }
  },
  exportHandler: ({ caps, ...rest } = {}, { convos, utterances } = {}, { statusCallback } = {}) => exportDialogflowCXIntents({ caps, ...rest }, { convos, utterances }, { statusCallback }),
  exportArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    }
  }
}
