import {contractErrorsAbi, decodePlaceOrder} from "@somnia-chain/markets-sdk";
import {createPublicClient,createWalletClient,http,parseAbi,type Chain} from "viem";
import {privateKeyToAccount} from "viem/accounts";

// DreamDEX's documented linked-bot route. The SDK currently has no perp ...For write.
const ABI=[
  ...parseAbi([
    "function isOperatorAuthorized(address owner,address operator,bytes4 selector) view returns (bool)",
    "function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool success,uint128 orderId)",
    "function cancelOrderFor(address owner,uint128 orderId)",
  ]),...contractErrorsAbi,
] as const;
const ZERO="0x0000000000000000000000000000000000000000" as const;
const PLACE_SELECTOR="0x80054449" as const;
const CANCEL_SELECTOR="0xe37b444b" as const;
export interface Placement {
  hash:`0x${string}`;receiptStatus:"success"|"reverted";
  orderId?:string;fillCount:number;
}
export class LinkedBot {
  private readonly account;
  private readonly publicClient;
  private readonly wallet;
  constructor(private readonly owner:`0x${string}`,key:`0x${string}`,chain:Chain,rpc:string) {
    this.account=privateKeyToAccount(key);
    if(this.account.address.toLowerCase()===owner.toLowerCase())
      throw new Error("Bot key must be separate from the owner's wallet");
    this.publicClient=createPublicClient({chain,transport:http(rpc)});
    this.wallet=createWalletClient({account:this.account,chain,transport:http(rpc)});
  }
  get address(){return this.account.address;}
  async authorized(pool:`0x${string}`) {
    const ask=(selector:`0x${string}`)=>this.publicClient.readContract({
      address:pool,abi:ABI,functionName:"isOperatorAuthorized",
      args:[this.owner,this.account.address,selector],
    });
    const [place,cancel]=await Promise.all([ask(PLACE_SELECTOR),ask(CANCEL_SELECTOR)]);
    return Boolean(place&&cancel);
  }
  async place(input:{pool:`0x${string}`;isBid:boolean;price:bigint;quantity:bigint;orderType:0|2|3},
    onHash:(hash:`0x${string}`)=>Promise<void>):Promise<Placement> {
    const expires=BigInt(Math.floor(Date.now()/1000)+300)*1_000_000_000n;
    const args=[this.owner,input.isBid,0n,input.price,input.quantity,expires,input.orderType,0,ZERO,0n] as const;
    const {request}=await this.publicClient.simulateContract({
      address:input.pool,abi:ABI,functionName:"placeOrderFor",args,account:this.account,gas:10_000_000n,
    });
    const hash=await this.wallet.writeContract(request);
    // Persist the hash before waiting, so receipt timeouts can be reconciled without retry.
    await onHash(hash);
    const receipt=await this.publicClient.waitForTransactionReceipt({hash,timeout:90_000});
    const decoded=receipt.status==="success"?decodePlaceOrder(receipt,input.pool):null;
    return {hash,receiptStatus:receipt.status,
      orderId:decoded?.orderId?.toString(),fillCount:decoded?.fills.length??0};
  }
}
