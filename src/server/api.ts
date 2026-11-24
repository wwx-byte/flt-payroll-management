import { implement, ORPCError } from '@orpc/server'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { contract } from '../api/contract'
import { readState, saveState } from './store'

const api = implement(contract)
const read = api.read.handler(() => readState())
const save = api.save.handler(({ input }) => {
  try {
    return saveState(input.rev, input.state)
  } catch (error) {
    if (error instanceof ORPCError) throw error
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      message: '本机数据库暂时不可用，请重试。',
      cause: error,
    })
  }
})
export const handler = new OpenAPIHandler({ read, save })
