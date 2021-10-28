const BotiumConnectorDialogflowCX = require('./src/connector')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorDialogflowCX,
  PluginDesc: {
    name: 'Google Dialogflow CX',
    provider: 'Google',
    features: {
      intentResolution: true,
      intentConfidenceScore: true,
      audioInput: true,
      supportedFileExtensions: ['.wav', '.pcm', '.m4a', '.flac', '.riff', '.wma', '.aac', '.ogg', '.oga', '.mp3', '.amr']
    },
    helperText: 'You have to download your <a href="https://cloud.google.com/docs/authentication/getting-started" target="_blank">Google credentials</a> for accessing your Dialogflow CX Agent first. Project Id, Agent Id and Location can be found in the <a href="https://cloud.google.com/dialogflow/cx/docs/quick/api" target="_blank">Dialogflow CX Console</a>.',
    capabilities: [
      {
        name: 'DIALOGFLOWCX_PROJECT_ID',
        label: 'Project Id',
        description: 'You can find this in the Dialogflow CX Console',
        type: 'string',
        required: true
      },
      {
        name: 'DIALOGFLOWCX_LOCATION',
        label: 'Location',
        description: 'You can find this in the Dialogflow CX Console',
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
        description: 'You can find this in the Dialogflow CX Console',
        type: 'string',
        required: true
      },
      {
        name: 'DIALOGFLOWCX_ENVIRONMENT',
        label: 'Environment',
        description: 'Dialogflow publishing environment name',
        type: 'string',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_CLIENT_EMAIL',
        label: 'Credentials Client Email',
        description: 'You can find this in the Google Cloud credentials file',
        type: 'string',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_PRIVATE_KEY',
        label: 'Credentials Private Key',
        description: 'You can find this in the Google Cloud credentials file',
        type: 'secret',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_LANGUAGE_CODE',
        label: 'Language Code',
        type: 'string',
        required: false
      },
      {
        name: 'DIALOGFLOWCX_QUERY_PARAMS',
        label: 'Query Parameters',
        type: 'json',
        required: false,
        advanced: true
      }
    ]
  }
}
