const http = require('http')
const crypto = require('crypto')
const express = require('express')
const { createOAuthUrl, generateTokens } = require('./oauth2')

// TODO: replace with your own credentials
const YOUR_CLIENT_ID = 'xxx'
const YOUR_CLIENT_SECRET = 'xxx'
const YOUR_REDIRECT_URL = 'http://localhost:8080/oauth2callback'
/* Global variable that stores user credential in this code example.
 * ACTION ITEM for developers:
 *   Store user's refresh token in your data store if
 *   incorporating this code into your real app.
 *   For more information on handling refresh tokens,
 *   see https://github.com/googleapis/google-api-nodejs-client#handling-refresh-tokens
 */

async function main () {
  const app = express()

  // app.use(session({
  //   secret: 'your_secure_secret_key', // Replace with a strong secret
  //   resave: false,
  //   saveUninitialized: false
  // }))

  // Example on redirecting user to Google's OAuth 2.0 server.
  app.get('/', async (req, res) => {
    // Generate a secure random state value. It is not used in this example.
    const state = crypto.randomBytes(32).toString('hex')

    const authorizationUrl = createOAuthUrl(YOUR_CLIENT_ID, YOUR_CLIENT_SECRET, YOUR_REDIRECT_URL, state)

    res.redirect(authorizationUrl)
  })

  // Receive the callback from Google's OAuth 2.0 server.
  app.get('/oauth2callback', async (req, res) => {
    const url = `http://localhost:8080${req.url}`
    // Handle the OAuth 2.0 server response
    const tokens = await generateTokens(YOUR_CLIENT_ID, YOUR_CLIENT_SECRET, YOUR_REDIRECT_URL, url)
    console.log(`tokens ===> ${JSON.stringify(tokens)}`)
    res.send('Authentication successful! You can close this window.')
  })

  const server = http.createServer(app)
  server.listen(8080)
  console.log('Call http://localhost:8080/ for OAuth2 authentication')
}
main().catch(console.error)
