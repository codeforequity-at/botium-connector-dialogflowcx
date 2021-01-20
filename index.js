const BotiumConnectorDialogflowCX = require('./src/connector')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorDialogflowCX,
  PluginDesc: {
    name: 'IBM Watson Assistant',
    provider: 'IBM',
    features: {
      intentResolution: true,
      intentConfidenceScore: true,
      audioInput: true,
      supportedFileExtensions: ['.wav', '.pcm', '.m4a', '.flac', '.riff', '.wma', '.aac', '.ogg', '.oga', '.mp3', '.amr']
    },
    capabilities: [
      {
        name: 'DIALOGFLOWCX_PROJECT_ID',
        label: 'Project Id',
        type: 'string',
        required: true
      },
      {
        name: 'DIALOGFLOWCX_LOCATION',
        label: 'Location',
        type: 'choice',
        required: true,
        choices: [
          { name: 'us-central1 (Americas/Iowa)', key: 'us-central1' },
          { name: 'northamerica-northeast1 (Americas/Montréal)', key: 'northamerica-northeast1' },
          { name: 'us-east1 (Americas/South Carolina)', key: 'us-east1' },
          { name: 'europe-west1 (Europe/Belgium)', key: 'europe-west1' },
          { name: 'europe-west2 (Europe/London)', key: 'europe-west2' },
          { name: 'australia-southeast1 (Asia Pacific/Sydney)', key: 'australia-southeast1' },
          { name: 'asia-northeast1 (Asia Pacific/Tokyo)', key: 'asia-northeast1' }
        ]
      },
      {
        name: 'DIALOGFLOWCX_AGENT_ID',
        label: 'Agent Id',
        type: 'string',
        required: true
      },
      {
        name: 'DIALOGFLOWCX_ENVIRONMENT',
        label: 'Environment',
        type: 'string',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_CLIENT_EMAIL',
        label: 'Credentials Client Email',
        type: 'string',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_PRIVATE_KEY',
        label: 'Credentials Private Key',
        type: 'secret',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_LANGUAGE_CODE',
        label: 'Language Code',
        type: 'string',
        required: false
      }
    ]
  }
}
