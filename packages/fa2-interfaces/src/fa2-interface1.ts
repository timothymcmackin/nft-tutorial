import { BigNumber } from 'bignumber.js';

import { TezosToolkit } from '@taquito/taquito';
import { tzip12, Tzip12Module, TokenMetadata } from '@taquito/tzip12';
import { Tzip12ContractAbstraction } from '@taquito/tzip12';

import { Contract } from './type-aliases';

export type Tzip12Contract = Contract & {
  tzip12(this: Contract): Tzip12ContractAbstraction;
};

type Address = string;
type Nat = BigNumber;

export interface BalanceRequest {
  owner: Address;
  token_id: Nat;
}

export interface BalanceResponse {
  balance: Nat;
  request: BalanceRequest;
}

export interface Fa2Contract {
  tzToolkit: TezosToolkit;
  useLambdaView: (lambdaView: Address) => Fa2Contract;

  queryBalance: (owner: Address, tokenId: Nat) => Promise<Nat>;
  queryBalances: (requests: BalanceRequest[]) => Promise<BalanceResponse[]>;

  hasNftToken: (owner: Address, tokenId: Nat) => Promise<boolean>;
  hasNftTokens: (requests: BalanceRequest[]) => Promise<boolean[]>;

  tokenMetadata: (tokenIds: number[]) => Promise<TokenMetadata[]>;
}

const createFa2Contract = (
  tzt: TezosToolkit,
  contract: Tzip12Contract,
  lambdaView?: Address
): Fa2Contract => {
  const self: Fa2Contract = {
    tzToolkit: tzt,

    useLambdaView: (lambdaView: Address) =>
      createFa2Contract(tzt, contract, lambdaView),

    queryBalance: async (owner, tokenId) => {
      const responses = await self.queryBalances([
        { owner, token_id: tokenId }
      ]);

      return responses[0].balance;
    },

    queryBalances: async requests =>
      contract.views.balance_of(requests).read(lambdaView),

    hasNftToken: async (owner, tokenId) => {
      const responses = await self.hasNftTokens([{ owner, token_id: tokenId }]);
      return responses[0];
    },

    hasNftTokens: async requests => {
      const responses = await self.queryBalances(requests);

      const results = responses.map(r => {
        if (r.balance.eq(1)) return true;
        else if (r.balance.eq(0)) return false;
        else throw new Error(`Invalid NFT balance ${r.balance}`);
      });

      return results;
    },

    tokenMetadata: async tokenIds => {
      const requests = tokenIds.map(id =>
        contract.tzip12().getTokenMetadata(id)
      );
      return Promise.all(requests);
    }
  };

  return self;
};

export const createFa2 = (tzt: TezosToolkit, lambdaView?: Address) => {
  tzt.addExtension(new Tzip12Module());

  return {
    tzToolkit: tzt,

    at: async (contractAddress: Address) => {
      const contract = await tzt.contract.at(contractAddress, tzip12);
      return createFa2Contract(tzt, contract, lambdaView);
    },

    useLambdaView: (lambdaView: Address) => createFa2(tzt, lambdaView)
  };
};
