import type { ParentL1 } from '../../core/layers/Layer2System';
import type { ChainModel } from '../model/ChainModel';
import type { PosChainModel } from '../model/PosChainModel';

/**
 * Thin facades adapting the running L1 models to the ParentL1 contract
 * the Layer-2 core speaks — the L2 never holds an app model directly.
 */
function adapt(model: ChainModel | PosChainModel): ParentL1 {
	return {
		events: model.events,
		submitSettlement: (request) =>
			model.submitSigned(request.from, request.to, request.amount, {
				kind: request.kind,
				memo: request.memo,
			}),
		getConfirmations: (txHash) => model.getConfirmations(txHash),
		getBalance: (address) => model.getBalance(address),
		getTransactionMemo: (txHash) => model.getTransactionMemo(txHash),
	};
}

/** Bitcoin-style PoW parent (Lightning anchors here). */
export function powParent(model: ChainModel): ParentL1 {
	return adapt(model);
}

/** Ethereum-style PoS parent (the Base rollup anchors here). */
export function posParent(model: PosChainModel): ParentL1 {
	return adapt(model);
}
