// using 2 different versions to auth, see https://github.com/googleapis/google-auth-library-nodejs/issues/1952
const { OAuth2Client } = require('google-auth-library')
const { google } = require('googleapis')
const Capabilities = require('./Capabilities')

module.exports.validateOAuth2Caps = (caps) => {
  if (!caps[Capabilities.DIALOGFLOWCX_REFRESH_TOKEN]) throw new Error('DIALOGFLOWCX_REFRESH_TOKEN capability i required for OAuth2 authentication')
  if (!caps[Capabilities.DIALOGFLOWCX_CLIENT_ID] || !caps[Capabilities.DIALOGFLOWCX_CLIENT_SECRET]) throw new Error('DIALOGFLOWCX_CLIENT_ID and DIALOGFLOWCX_CLIENT_SECRET capabilities are required for OAuth2 authentication')
}

module.exports.createOAuth2Client = (caps) => {
  const oauth2Client = new OAuth2Client(
    caps[Capabilities.DIALOGFLOWCX_CLIENT_ID],
    caps[Capabilities.DIALOGFLOWCX_CLIENT_SECRET]
  )
  oauth2Client.setCredentials({
    refresh_token: caps[Capabilities.DIALOGFLOWCX_REFRESH_TOKEN]
  })

  return oauth2Client
}

module.exports.createOAuthUrl = (clientId, clientSecret, redirectURI, state) => {
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectURI
  )
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/dialogflow',
    include_granted_scopes: true,
    state,
    // Force to display the consent screen in every authorization, to get a refresh token every time
    prompt: 'consent'
  })
}

module.exports.getState = (url) => {
  // eslint-disable-next-line new-cap
  const u = new URL(url)
  const state = u.searchParams?.get('state')
  if (!state) {
    throw new Error('State not found in URL')
  }

  return state
}

module.exports.generateTokens = async (clientId, clientSecret, redirectURI, url) => {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectURI)
  const u = new URL(url)
  const sp = u.searchParams

  const error = sp?.get('error')
  if (error) { // An error response e.g. error=access_denied
    throw new Error(`Authentication error, failed to extract tokens: ${error}`)
    // Does not work for me? req.session.state is not set
    // } else if (q.state !== req.session.state) { //check state value
    //   console.log('State mismatch. Possible CSRF attack');
    //   res.end('State mismatch. Possible CSRF attack');
  } else {
    if (!sp.get('code')) {
      throw new Error('Code not found in URL')
    }
    const { tokens } = await oauth2Client.getToken(sp.get('code'))
    return tokens
  }
}
