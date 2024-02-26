module.exports.countList = async (client, fnc, params = {}) => {
  let nextPageToken
  let result = 0
  do {
    params = Object.assign({}, params, {
      pageToken: nextPageToken,
      pageSize: 2
    })
    const response = await client[fnc](params)
    result += response[0].length
    response[0] = `array length ${response[0].length}`
    nextPageToken = response[2]?.nextPageToken
  } while (nextPageToken)
  return result
}

module.exports.getList = async (client, fnc, params = {}, limit) => {
  let nextPageToken
  let result = []
  do {
    params = Object.assign({}, {
      pageToken: nextPageToken,
      pageSize: 100
    }, params)

    const response = await limit(() => client[fnc](params))
    result = result.concat(response[0])
    nextPageToken = response[2]?.nextPageToken
  } while (nextPageToken)

  return result
}

module.exports.isCommandPage = (pagePath) => {
  return pagePath.endsWith('/pages/END_SESSION') || pagePath.endsWith('/pages/PREVIOUS_PAGE') || pagePath.endsWith('/pages/CURRENT_PAGE') || pagePath.endsWith('/pages/START_PAGE') || pagePath.endsWith('/pages/END_FLOW') || pagePath.endsWith('/pages/END_FLOW_WITH_CANCELLATION') || pagePath.endsWith('/pages/END_FLOW_WITH_HUMAN_ESCALATION') || pagePath.endsWith('/pages/END_FLOW_WITH_FAILURE')
}

module.exports.targetCommand = (pagePath) => {
  if (pagePath.endsWith('/pages/END_SESSION')) {
    return 'End Session'
  }
  if (pagePath.endsWith('/pages/PREVIOUS_PAGE')) {
    return 'Previous Page'
  }
  if (pagePath.endsWith('/pages/CURRENT_PAGE')) {
    return 'Current Page'
  }
  if (pagePath.endsWith('/pages/START_PAGE')) {
    return 'Start Page'
  }
  if (pagePath.endsWith('/pages/END_FLOW')) {
    return 'End Flow'
  }
  if (pagePath.endsWith('/pages/END_FLOW_WITH_CANCELLATION')) {
    return 'End Flow With Cancellation'
  }
  if (pagePath.endsWith('/pages/END_FLOW_WITH_HUMAN_ESCALATION')) {
    return 'End Flow With Human Escalation'
  }
  if (pagePath.endsWith('/pages/END_FLOW_WITH_FAILURE')) {
    return 'End Flow With Failure'
  }
}
