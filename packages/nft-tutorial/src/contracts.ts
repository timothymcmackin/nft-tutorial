import Configstore from 'configstore';
import * as kleur from 'kleur';
import * as path from 'path';
import { BigNumber } from 'bignumber.js';
import { TezosToolkit, MichelsonMap } from '@taquito/taquito';
import { char2Bytes } from '@taquito/utils';
import { InMemorySigner } from '@taquito/signer';
import { TokenMetadata } from '@taquito/tzip12';
import {
  loadUserConfig,
  loadFile,
  activeNetworkKey,
  lambdaViewKey
} from './config-util';
import {
  resolveAlias2Signer,
  resolveAlias2Address,
  addAlias
} from './config-aliases';
import * as fa2 from '@oxheadalpha/fa2-interfaces';
import * as nft from './nft-interface';
import { bytes } from '@oxheadalpha/fa2-interfaces';
import { originateContract } from '@oxheadalpha/nft-contracts';

export async function createToolkit(
  address_or_alias: string,
  config: Configstore
): Promise<TezosToolkit> {
  const signer = await resolveAlias2Signer(address_or_alias, config);
  return createToolkitFromSigner(signer, config);
}

export function createToolkitFromSigner(
  signer: InMemorySigner,
  config: Configstore
): TezosToolkit {
  const pk = `${activeNetworkKey(config)}.providerUrl`;
  const providerUrl = config.get(pk);
  if (!providerUrl) {
    const msg = `network provider for ${kleur.yellow(
      config.get('activeNetwork')
    )} URL is not configured`;
    console.log(kleur.red(msg));
    throw new Error(msg);
  }

  const toolkit = new TezosToolkit(providerUrl);
  toolkit.setProvider({
    signer,
    rpc: providerUrl,
    config: { confirmationPollingIntervalSecond: 5 }
  });
  return toolkit;
}

export async function createCollection(
  owner: string,
  metaFile: string,
  alias?: string
): Promise<void> {
  const config = loadUserConfig();
  const tz = await createToolkit(owner, config);
  const ownerAddress = await tz.signer.publicKeyHash();

  const code = await loadFile(path.join(__dirname, './fa2_nft_asset.tz'));
  const metaJson = await loadFile(metaFile);
  const storage = createNftStorage(ownerAddress, metaJson);

  console.log(kleur.yellow('originating new NFT contract...'));
  const contract = await originateContract(tz, code, storage, 'nft');

  if (alias) {
    const meta = JSON.parse(metaJson);
    await addAlias(alias, contract.address);
  }
}

export async function mintNfts(
  owner: string,
  collection: string,
  tokens: fa2.TokenMetadataInternal[]
): Promise<void> {
  if (tokens.length === 0)
    return Promise.reject('there are no token definitions provided');

  const config = loadUserConfig();
  const tz = await createToolkit(owner, config);
  const collectionAddress = await resolveAlias2Address(collection, config);
  const ownerAddress = await tz.signer.publicKeyHash();

  await nft.mintTokens(collectionAddress, tz, [
    { owner: ownerAddress, tokens }
  ]);
}

export async function mintFreeze(
  owner: string,
  collection: string
): Promise<void> {
  const config = loadUserConfig();
  const tz = await createToolkit(owner, config);
  const collectionAddress = await resolveAlias2Address(collection, config);
  await nft.freezeCollection(collectionAddress, tz);
}

export function parseTokens(
  descriptor: string,
  tokens: fa2.TokenMetadataInternal[]
): fa2.TokenMetadataInternal[] {
  const [id, tokenMetadataUri] = descriptor.split(',').map(p => p.trim());
  const token: fa2.TokenMetadataInternal = {
    token_id: new BigNumber(id),
    token_info: new MichelsonMap()
  };
  token.token_info.set('', char2Bytes(tokenMetadataUri));
  return [token].concat(tokens);
}

function createNftStorage(owner: string, metaJson: string) {
  const assets = {
    ledger: new MichelsonMap(),
    operators: new MichelsonMap(),
    token_metadata: new MichelsonMap()
  };
  const admin = {
    admin: owner,
    pending_admin: undefined,
    paused: false
  };
  const metadata = new MichelsonMap<string, bytes>();
  metadata.set('', char2Bytes('tezos-storage:content'));
  metadata.set('content', char2Bytes(metaJson));

  return {
    assets,
    admin,
    metadata,
    mint_freeze: false
  };
}

export async function showBalances(
  signer: string,
  contract: string,
  owner: string,
  tokens: string[]
): Promise<void> {
  const config = loadUserConfig();

  const tz = await createToolkit(signer, config);
  const ownerAddress = await resolveAlias2Address(owner, config);
  const nftAddress = await resolveAlias2Address(contract, config);
  const lambdaView = config.get(lambdaViewKey(config));
  const requests: fa2.BalanceOfRequest[] = tokens.map(t => {
    return { token_id: new BigNumber(t), owner: ownerAddress };
  });

  const fa2Contract = await fa2.createFa2(tz).useLambdaView(lambdaView).at(nftAddress);

  console.log(kleur.yellow(`querying NFT contract ${kleur.green(nftAddress)}`));
  const balances = await fa2Contract.queryBalances(requests)  
  
  printBalances(balances);
}

function printBalances(balances: fa2.BalanceOfResponse[]): void {
  console.log(kleur.green('requested NFT balances:'));
  for (let b of balances) {
    console.log(
      kleur.yellow(
        `owner: ${kleur.green(b.request.owner)}\ttoken: ${kleur.green(
          b.request.token_id.toString()
        )}\tbalance: ${kleur.green(b.balance.toString())}`
      )
    );
  }
}

export async function showMetadata(
  signer: string,
  contract: string,
  tokens: string[]
): Promise<void> {
  const config = loadUserConfig();

  const tz = await createToolkit(signer, config);
  const nftAddress = await resolveAlias2Address(contract, config);
  const tokenIds = tokens.map(t => Number.parseInt(t));
 
  const fa2Contract = await fa2.createFa2(tz).at(nftAddress);

  console.log(kleur.yellow('querying token metadata...'));
  const tokensMeta = await fa2Contract.tokensMetadata(tokenIds)
  
  tokensMeta.forEach(printTokenMetadata);
}

function printTokenMetadata(m: TokenMetadata) {
  console.log(kleur.green(JSON.stringify(m, null, 2)));
}

export function parseTransfers(
  description: string,
  batch: fa2.Fa2Transfer[]
): fa2.Fa2Transfer[] {
  const [from_, to_, token_id] = description.split(',').map(p => p.trim());
  const tx: fa2.Fa2Transfer = {
    from_,
    txs: [
      {
        to_,
        token_id: new BigNumber(token_id),
        amount: new BigNumber(1)
      }
    ]
  };
  if (batch.length > 0 && batch[0].from_ === from_) {
    //merge last two transfers if their from_ addresses are the same
    batch[0].txs = batch[0].txs.concat(tx.txs);
    return batch;
  }

  return batch.concat(tx);
}

export async function transfer(
  signer: string,
  contract: string,
  batch: fa2.Fa2Transfer[]
): Promise<void> {
  const config = loadUserConfig();
  const txs = await resolveTxAddresses(batch, config);
  const nftAddress = await resolveAlias2Address(contract, config);
  const tz = await createToolkit(signer, config);
  await fa2.transfer(nftAddress, tz, txs);
}

async function resolveTxAddresses(
  transfers: fa2.Fa2Transfer[],
  config: Configstore
): Promise<fa2.Fa2Transfer[]> {
  const resolved = transfers.map(async t => {
    return {
      from_: await resolveAlias2Address(t.from_, config),
      txs: await resolveTxDestinationAddresses(t.txs, config)
    };
  });
  return Promise.all(resolved);
}

async function resolveTxDestinationAddresses(
  txs: fa2.Fa2TransferDestination[],
  config: Configstore
): Promise<fa2.Fa2TransferDestination[]> {
  const resolved = txs.map(async t => {
    return {
      to_: await resolveAlias2Address(t.to_, config),
      amount: t.amount,
      token_id: t.token_id
    };
  });
  return Promise.all(resolved);
}

export async function updateOperators(
  owner: string,
  contract: string,
  addOperators: string[],
  removeOperators: string[]
): Promise<void> {
  const config = loadUserConfig();
  const tz = await createToolkit(owner, config);
  const ownerAddress = await tz.signer.publicKeyHash();
  const resolvedAdd = await resolveOperators(
    ownerAddress,
    addOperators,
    config
  );
  const resolvedRemove = await resolveOperators(
    ownerAddress,
    removeOperators,
    config
  );
  const nftAddress = await resolveAlias2Address(contract, config);
  await fa2.updateOperators(nftAddress, tz, resolvedAdd, resolvedRemove);
}

async function resolveOperators(
  owner: string,
  operators: string[],
  config: Configstore
): Promise<fa2.OperatorParam[]> {
  const resolved = operators.map(async o => {
    try {
      const [op, token] = o.split(',');
      const operator = await resolveAlias2Address(op, config);
      const token_id = new BigNumber(token);

      return { owner, operator, token_id };
    } catch (e) {
      console.log(
        kleur.red(`cannot parse operator definition ${kleur.yellow(o)}`)
      );
      console.log(
        kleur.red(
          "correct operator format is 'operator_alias_or_address, token_id'"
        )
      );
      throw e;
    }
  });
  return Promise.all(resolved);
}
