import 'source-map-support/register'
import Joi from 'joi'
import { makeResponse } from '../../infrastructure/http/makeResponse'
import stream from 'getstream'
import md5 from 'md5'
import { userApi } from '../../infrastructure/databases/users/userApi'

const getStreamClient = stream.connect(
  process.env.GETSTREAM_KEY,
  process.env.GETSTREAM_SECRET,
  process.env.GETSTREAM_APPID
)

let userIdUsernameCache = {}

async function getUsername(userId) {
  if (!userId) {
    return ''
  } else if (userIdUsernameCache[userId]) {
    return userIdUsernameCache[userId]
  } else {
    userIdUsernameCache = await userApi.listAllUsers()
    return userIdUsernameCache[userId]
  }
}

export const handler = async (event, context, cb) => {
  //console.log(JSON.stringify(event))

  const { error } = Joi.validate(
    event.pathParameters,
    Joi.object().keys({
      username: Joi.string().required()
    })
  )

  if (error) {
    return cb(null, makeResponse(400, error))
  }

  let showUserId
  try {
    showUserId = await userApi.getUserIdByUsername(
      event.pathParameters.username
    )
  } catch (err) {
    console.log(err)
  }

  if (!showUserId) {
    cb(null, makeResponse(404, 'user not found'))
  }

  const feed = getStreamClient.feed('user', md5(showUserId))

  const queryParams = event.queryStringParameters || {}
  const offset = parseInt(queryParams.offset || 0)
  const limit = parseInt(queryParams.limit || 10)

  return feed
    .get({ limit, offset })
    .then((res: any) => {
      return {
        links: res.results.map(result => ({
          ...JSON.parse(result.object),
          time: result.time
        })),
        next: res.next
      }
    })
    .then(res => {
      return Promise.all(res.links.map(link => getUsername(link.userId))).then(
        usernames => {
          return {
            links: res.links.map((link, index) => ({
              ...link,
              username: usernames[index]
            })),
            next: !!res.next
          }
        }
      )
    })
    .then(data => cb(null, makeResponse(200, data)))
    .catch(err => {
      console.error(err)
      cb(
        null,
        makeResponse(err.statusCode || 500, {
          message: err.message,
          errorCode: err.code
        })
      )
    })
}
