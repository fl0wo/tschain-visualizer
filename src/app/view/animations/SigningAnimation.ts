import * as THREE from 'three';
import type { TxCubeMesh } from '../TxCubeMesh';
import { boosted, theme } from '../theme';
import type { Tweens } from '../tween';
import { TextSprite } from './TextSprite';

/**
 * # SigningAnimation
 *
 * The story: the sender's PRIVATE KEY (a tiny glowing diamond — there is
 * exactly one in the whole scene, because a private key must never be
 * duplicated) flies to the transaction, orbits it once, and "stamps" it:
 * a teal ring seals around the cube while the signature string types
 * itself out above. What remains afterward is the small persistent teal
 * seal — the cube now carries a verifiable signature.
 */

// The one-and-only private key diamond. Module-level singleton: if a new
// signing starts while another runs, the key is *taken* — never cloned.
const KEY_DIAMOND = new THREE.Mesh(
	new THREE.OctahedronGeometry(0.09),
	new THREE.MeshBasicMaterial({ color: boosted(theme.colors.active, theme.boost.pulse) }),
);
let keyOwner: SigningAnimation | null = null;

export class SigningAnimation {
	readonly finished: Promise<void>;

	constructor(cube: TxCubeMesh, sigHash: string, tweens: Tweens) {
		this.finished = this.play(cube, sigHash, tweens);
	}

	private async play(cube: TxCubeMesh, sigHash: string, tweens: Tweens): Promise<void> {
		// Take the key (stealing it from a concurrent signing if needed).
		keyOwner = this;
		KEY_DIAMOND.removeFromParent();
		cube.group.add(KEY_DIAMOND);

		// One orbit around the cube, descending slightly — the key
		// "inspecting" what it is about to authorize.
		const radius = theme.layout.txCubeSize * 1.4;
		await tweens.run(theme.timing.signingOrbit, (t) => {
			const angle = t * Math.PI * 2;
			KEY_DIAMOND.position.set(
				Math.cos(angle) * radius,
				0.35 * (1 - t),
				Math.sin(angle) * radius,
			);
			KEY_DIAMOND.rotation.y = angle * 2;
		}).finished;

		// The stamp: the persistent seal ring pops in.
		cube.addSeal();
		const popHandle = tweens.run(theme.timing.signingSeal, (t) => {
			cube.group.scale.setScalar(1 + 0.18 * Math.sin(t * Math.PI));
		});
		cube.activeHandles.push(popHandle);

		// Release the key the moment the stamp lands — its job is done.
		if (keyOwner === this) KEY_DIAMOND.removeFromParent();

		// Typewriter: `sig: 0x1a2b…` appears character by character.
		const label = new TextSprite(1.9);
		label.sprite.position.y = theme.layout.txCubeSize * 1.6;
		cube.group.add(label.sprite);
		const text = `sig: 0x${sigHash.slice(0, 6)}…`;
		const typeHandle = tweens.run(theme.timing.signingType, (t) => {
			label.set([text.slice(0, Math.ceil(t * text.length))]);
		});
		cube.activeHandles.push(typeHandle);
		await typeHandle.finished;

		await tweens.wait(theme.timing.signingHold);
		const fade = tweens.run(0.25, (t) => (label.opacity = 1 - t));
		cube.activeHandles.push(fade);
		await fade.finished;
		cube.group.remove(label.sprite);
		label.dispose();
	}
}
