import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { contract } from './contract'

export function payrollClient(
  origin: string,
): ContractRouterClient<typeof contract> {
  return createORPCClient(new OpenAPILink(contract, { url: origin + '/api' }))
}
