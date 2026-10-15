import AddCardRoundedIcon from '@mui/icons-material/AddCardRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cardKeyIndexesUsedAtom,
  linkedCardsAtom,
  NO_TOP_UP,
  pendingTopUpAtom,
  startCardTopUp,
  type LinkedCard,
} from '../../atoms/qortalCard';
import { publishCardAvatar } from '../../qortalCard/cardAvatar';
import { buildCardBackup } from '../../qortalCard/cardBackup';
import {
  connectCard,
  defaultCardFlowDeps,
  loadWalletKey,
  makeKeyOnCard,
  paymentTx,
  pickWalletKeyIndex,
  readCard,
  registerNameTx,
  signTxOnCard,
  signTxWithWalletKey,
  type CardInfo,
  type SignedCharge,
  type TxBuild,
  type WalletKeyOffer,
} from '../../qortalCard/cardFlows';
import { findWalletKeyIndex } from '../../qortalCard/cardKeys';
import {
  broadcastSignedTx,
  fetchQortBalance,
  fetchUnitFee,
  isAddressUsed,
  NodeError,
} from '../../qortalCard/cardNode';
import { CardError } from '../../qortalCard/cardProtocol';
import { formatQortUnits } from '../../qortalCard/cardTx';
import { Base58 } from '../../qortalCard/cryptoDeps';
import { loadMainPrivateKey } from '../../qortalCard/mainKey';
import { executeEvent } from '../../utils/events';
import { fileToBase64 } from '../../utils/fileReading';
import { saveFileToDisk } from '../../utils/generateWallet/generateWallet';
import { applyPublishedOwnAvatar } from '../../utils/ownQdnAvatarPublish';
import { hintSx } from './CardForms';
import {
  CardItem,
  type CardFormMode,
  type CardNotice,
  type OpenCardForm,
} from './CardItem';
import { cardErrorText, isCancelled } from './cardErrorText';
import {
  labelSx,
  noteSx,
  shortAddress,
  surfaceSx,
  type NoteTone,
} from './cardStyles';
import type { RunWithCard } from './useCardTap';
import { useCardStates } from './useCardStates';

const NO_CARDS: LinkedCard[] = [];

type WalletOffer = {
  offer: WalletKeyOffer | null;
  /** Why no offer could be made. */
  reason: string | null;
  /** Zeroed by the caller once the tap is over. */
  mainKey: Uint8Array | null;
};

/**
 * My card: connect a card in one tap (a blank card gets its key in the same
 * tap), top it up, move QORT back, give it a name and avatar on chain, save
 * a backup file of its account.
 */
export function MyCardsPanel({
  address,
  nfcReady,
  run,
}: {
  address: string;
  nfcReady: boolean;
  run: RunWithCard;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [linked, setLinked] = useAtom(linkedCardsAtom);
  const [indexesUsed, setIndexesUsed] = useAtom(cardKeyIndexesUsedAtom);
  const [pendingTopUp, setPendingTopUp] = useAtom(pendingTopUpAtom);
  const cards = linked[address] ?? NO_CARDS;
  const addresses = useMemo(() => cards.map((card) => card.address), [cards]);
  const { states, refresh, watch, watching } = useCardStates(addresses);
  const [topNotice, setTopNotice] = useState<{
    tone: NoteTone;
    text: string;
  } | null>(null);
  /** A blank card that could take a wallet key, but none was ready. */
  const [needsWallet, setNeedsWallet] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, CardNotice>>({});
  const [form, setForm] = useState<OpenCardForm | null>(null);
  /** Names sent to the chain, per card, until they show. */
  const [registering, setRegistering] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const notify = (cardAddress: string, notice: CardNotice | null) =>
    setNotices((all) => {
      const next = { ...all };
      if (notice) next[cardAddress] = notice;
      else delete next[cardAddress];
      return next;
    });

  const fail = (cardAddress: string, error: unknown) => {
    if (!isCancelled(error)) {
      notify(cardAddress, { tone: 'error', text: cardErrorText(t, error) });
    }
  };

  // Back from Send QORT after a top up: watch the balance until it shows.
  useEffect(() => {
    if (!pendingTopUp.address || !pendingTopUp.sent) return;
    const target = pendingTopUp.address;
    setPendingTopUp(NO_TOP_UP);
    if (!addresses.includes(target)) return;
    notify(target, {
      tone: 'success',
      text: t('core:qortal_card.card.top_up_sent'),
    });
    void refresh([target]).then((fresh) => {
      const from = fresh[target]?.balance ?? null;
      watch(
        target,
        (state) =>
          state.balance !== null && from !== null && state.balance !== from
      );
    });
    // Only when a top up comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTopUp]);

  // A registered name showed up (or the wait ran out).
  useEffect(() => {
    for (const [cardAddress, name] of Object.entries(registering)) {
      const onChain = states[cardAddress]?.name;
      if (!onChain && watching.has(cardAddress)) continue;
      setRegistering((all) => {
        const next = { ...all };
        delete next[cardAddress];
        return next;
      });
      const card = cards.find((item) => item.address === cardAddress);
      if (!onChain) {
        notify(cardAddress, {
          tone: 'info',
          text: t('core:qortal_card.name.slow', { name }),
        });
      } else {
        notify(cardAddress, {
          tone: 'success',
          text: t('core:qortal_card.name.done', { name: onChain }),
          action:
            card && card.walletKeyIndex !== null
              ? {
                  label: t('core:qortal_card.avatar.add'),
                  run: () => {
                    notify(cardAddress, null);
                    setForm({ address: cardAddress, mode: 'avatar' });
                  },
                }
              : undefined,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, watching, registering]);

  // Switching a card's key: once the move back shows on chain, the card can
  // take the new key. If the wait runs out, show what the address holds now.
  useEffect(() => {
    if (form?.mode !== 'switch' || form.stage !== 'waiting') return;
    const balance = states[form.address]?.balance;
    if (balance === 0n) {
      setForm({ ...form, stage: 'ready', balance: 0n });
    } else if (!watching.has(form.address) && balance != null) {
      setForm({
        ...form,
        stage: balance > form.fee ? 'confirm' : 'ready',
        balance,
      });
    }
  }, [states, watching, form]);

  const saveCard = (info: CardInfo) => {
    setLinked((all) => {
      const list = all[address] ?? [];
      const known = list.find((card) => card.address === info.address);
      const card: LinkedCard = {
        ...known,
        address: info.address,
        publicKey: Base58.encode(info.publicKey),
        applet: info.applet,
        walletKeyIndex: info.walletKeyIndex,
        linkedAt: known?.linkedAt ?? Date.now(),
      };
      return {
        ...all,
        [address]: known
          ? list.map((item) => (item.address === info.address ? card : item))
          : [...list, card],
      };
    });
  };

  const reserveIndex = (index: number) =>
    setIndexesUsed((all) => {
      const list = all[address] ?? [];
      return list.includes(index)
        ? all
        : { ...all, [address]: [...list, index] };
    });

  /** A wallet card key for a blank card, made ready before the tap. */
  const prepareWalletOffer = async (): Promise<WalletOffer> => {
    let mainKey: Uint8Array | null = null;
    try {
      mainKey = await loadMainPrivateKey();
      const key = mainKey;
      const index = await pickWalletKeyIndex(
        key,
        indexesUsed[address] ?? [],
        isAddressUsed
      );
      return {
        mainKey,
        reason: null,
        offer: {
          mainPrivateKey: key,
          index,
          // Reserved right before loading: even a broken-off setup may
          // have put the key on the card.
          reserve: () => reserveIndex(index),
        },
      };
    } catch (error) {
      return { mainKey, offer: null, reason: cardErrorText(t, error) };
    }
  };

  const connect = async () => {
    setTopNotice(null);
    setNeedsWallet(null);
    setForm(null);
    setBusy(true);
    // Got ready while the card is on its way; only a blank card waits for it.
    const prepared = prepareWalletOffer();
    try {
      // A card that slips away gets asked for again; a key already loaded
      // by the first try is then simply read and recognised below.
      const outcome = await run(
        t('core:qortal_card.prompt.connect'),
        (card) => connectCard(card, async () => (await prepared).offer),
        { retries: 2 }
      );
      const { reason, mainKey } = await prepared;
      if (outcome.kind === 'needs-wallet') {
        setNeedsWallet(reason ?? '');
        return;
      }
      const info = outcome.info;
      if (outcome.kind === 'linked' && mainKey && info.publicKey) {
        info.walletKeyIndex = findWalletKeyIndex(mainKey, info.publicKey);
      }
      const known = cards.some((card) => card.address === info.address);
      saveCard(info);
      setTopNotice({
        tone: 'success',
        text:
          outcome.kind === 'set-up'
            ? t('core:qortal_card.setup.done')
            : known
              ? t('core:qortal_card.card.already_connected')
              : t('core:qortal_card.card.connected'),
      });
      if (info.address) void refresh([info.address]);
    } catch (error) {
      if (!isCancelled(error)) {
        setTopNotice({ tone: 'error', text: cardErrorText(t, error) });
      }
    } finally {
      (await prepared).mainKey?.fill(0);
      setBusy(false);
    }
  };

  /** A blank card makes its own key (no wallet key could be made ready). */
  const makeOwnKey = async () => {
    setNeedsWallet(null);
    setBusy(true);
    try {
      const info = await run(
        t('core:qortal_card.prompt.setup'),
        async (card) => {
          const read = await readCard(card);
          // A retry after a slip finds the key the first try made.
          return read.publicKey
            ? read
            : makeKeyOnCard(card, defaultCardFlowDeps, { applet: read.applet });
        },
        { retries: 2 }
      );
      saveCard(info);
      setTopNotice({ tone: 'success', text: t('core:qortal_card.setup.done') });
      if (info.address) void refresh([info.address]);
    } catch (error) {
      if (!isCancelled(error)) {
        setTopNotice({ tone: 'error', text: cardErrorText(t, error) });
      }
    } finally {
      setBusy(false);
    }
  };

  /** Signs for a card: GO for a wallet key, the card itself otherwise. */
  const signFor = async (
    card: LinkedCard,
    build: TxBuild,
    prompt: string
  ): Promise<SignedCharge> => {
    if (card.walletKeyIndex !== null) {
      const mainKey = await loadMainPrivateKey();
      try {
        return signTxWithWalletKey(
          mainKey,
          card.walletKeyIndex,
          build,
          card.address
        );
      } finally {
        mainKey.fill(0);
      }
    }
    return run(prompt, (link) => signTxOnCard(link, build, card.address), {
      retries: 2,
    });
  };

  const broadcast = async (signed: SignedCharge) => {
    const result = await broadcastSignedTx(signed.signedBase58);
    if (result.ok === false) throw new NodeError(result.message);
  };

  const topUp = (card: LinkedCard) => {
    setForm(null);
    startCardTopUp(card.address);
    executeEvent('openPaymentInternal', { address: card.address });
  };

  const prepareMove = async (card: LinkedCard) => {
    setForm(null);
    notify(card.address, null);
    setBusy(true);
    try {
      const [balance, fee] = await Promise.all([
        fetchQortBalance(card.address),
        fetchUnitFee('payment'),
      ]);
      if (balance - fee <= 0n) {
        notify(card.address, {
          tone: 'info',
          text: t('core:qortal_card.move_back.nothing'),
        });
        return;
      }
      setForm({ address: card.address, mode: 'move', balance, fee });
    } catch (error) {
      fail(card.address, error);
    } finally {
      setBusy(false);
    }
  };

  const confirmMove = async (card: LinkedCard, amount: bigint) => {
    if (form?.mode !== 'move' || form.address !== card.address) return;
    const { balance, fee } = form;
    notify(card.address, null);
    setBusy(true);
    try {
      const signed = await signFor(
        card,
        paymentTx({ recipient: address, amount, fee }),
        t('core:qortal_card.prompt.move_back')
      );
      await broadcast(signed);
      setForm(null);
      notify(card.address, {
        tone: 'success',
        text: t('core:qortal_card.move_back.sent', {
          amount: formatQortUnits(amount),
        }),
      });
      watch(
        card.address,
        (state) => state.balance !== null && state.balance !== balance
      );
    } catch (error) {
      // The form stays open: the same choice can be sent again.
      fail(card.address, error);
    } finally {
      setBusy(false);
    }
  };

  const registerName = async (card: LinkedCard, name: string, fee: bigint) => {
    notify(card.address, null);
    setBusy(true);
    try {
      const signed = await signFor(
        card,
        registerNameTx(name, fee),
        t('core:qortal_card.prompt.name', { name })
      );
      await broadcast(signed);
      setForm(null);
      setRegistering((all) => ({ ...all, [card.address]: name }));
      notify(card.address, {
        tone: 'success',
        text: t('core:qortal_card.name.sent', { name }),
      });
      watch(card.address, (state) => state.name !== null);
    } catch (error) {
      fail(card.address, error);
    } finally {
      setBusy(false);
    }
  };

  const publishAvatar = async (card: LinkedCard, file: File, fee: bigint) => {
    const name = states[card.address]?.name;
    if (!name || card.walletKeyIndex === null) return;
    notify(card.address, null);
    setBusy(true);
    let mainKey: Uint8Array | null = null;
    try {
      const base64 = String(await fileToBase64(file));
      mainKey = await loadMainPrivateKey();
      await publishCardAvatar({
        mainPrivateKey: mainKey,
        index: card.walletKeyIndex,
        address: card.address,
        name,
        base64,
        fee,
      });
      // Show it now, not when the node has caught up.
      void applyPublishedOwnAvatar(
        name,
        `data:${file.type || 'image/webp'};base64,${base64}`
      );
      setForm(null);
      notify(card.address, {
        tone: 'success',
        text: t('core:qortal_card.avatar.done'),
      });
      const before = states[card.address]?.balance ?? null;
      watch(
        card.address,
        (state) => state.balance !== null && state.balance !== before
      );
    } catch (error) {
      fail(card.address, error);
    } finally {
      mainKey?.fill(0);
      setBusy(false);
    }
  };

  const backup = async (card: LinkedCard, password: string) => {
    if (card.walletKeyIndex === null) return;
    notify(card.address, null);
    let mainKey: Uint8Array | null = null;
    try {
      mainKey = await loadMainPrivateKey();
      const data = await buildCardBackup(
        mainKey,
        card.walletKeyIndex,
        password,
        card.address
      );
      await saveFileToDisk(data, card.address);
      setForm(null);
      notify(card.address, {
        tone: 'success',
        text: t('core:qortal_card.backup.saved'),
      });
    } catch (error) {
      fail(card.address, error);
    } finally {
      mainKey?.fill(0);
    }
  };

  /** Starts switching a card with its own key to a key from the wallet. */
  const prepareSwitch = async (card: LinkedCard) => {
    notify(card.address, null);
    setBusy(true);
    try {
      const [balance, fee, state] = await Promise.all([
        fetchQortBalance(card.address),
        fetchUnitFee('payment'),
        refresh([card.address]).then((fresh) => fresh[card.address]),
      ]);
      // A name belongs to the old key: switching would leave it behind.
      if (state?.name) {
        notify(card.address, {
          tone: 'info',
          text: t('core:qortal_card.switch.has_name', { name: state.name }),
        });
        setForm(null);
        return;
      }
      setForm({
        address: card.address,
        mode: 'switch',
        stage: balance > fee ? 'confirm' : 'ready',
        balance,
        fee,
      });
    } catch (error) {
      fail(card.address, error);
    } finally {
      setBusy(false);
    }
  };

  /** Switch step 1: everything on the old key goes back to the account. */
  const switchMove = async (card: LinkedCard) => {
    if (form?.mode !== 'switch' || form.address !== card.address) return;
    const amount = form.balance - form.fee;
    if (amount <= 0n) return;
    notify(card.address, null);
    setBusy(true);
    try {
      const signed = await signFor(
        card,
        paymentTx({ recipient: address, amount, fee: form.fee }),
        t('core:qortal_card.prompt.move_back')
      );
      await broadcast(signed);
      setForm({ ...form, stage: 'waiting' });
      watch(card.address, (state) => state.balance === 0n);
    } catch (error) {
      fail(card.address, error);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Switch step 2: only an empty old address (or one holding less than a
   * fee) gets its key overwritten, and only on the same card.
   */
  const switchLoad = async (card: LinkedCard) => {
    if (form?.mode !== 'switch' || form.address !== card.address) return;
    notify(card.address, null);
    setBusy(true);
    let prepared: WalletOffer | null = null;
    try {
      const [left, fee] = await Promise.all([
        fetchQortBalance(card.address),
        fetchUnitFee('payment'),
      ]);
      if (left > fee) {
        setForm({ ...form, stage: 'confirm', balance: left, fee });
        notify(card.address, {
          tone: 'warning',
          text: t('core:qortal_card.switch.not_empty', {
            amount: formatQortUnits(left),
          }),
        });
        return;
      }
      prepared = await prepareWalletOffer();
      const offer = prepared.offer;
      if (!offer) {
        notify(card.address, { tone: 'error', text: prepared.reason ?? '' });
        return;
      }
      const info = await run(
        t('core:qortal_card.prompt.switch'),
        async (link) => {
          const now = await readCard(link);
          if (now.publicKey && now.address !== card.address) {
            // A retry after a slip finds the new key already there.
            if (
              findWalletKeyIndex(offer.mainPrivateKey, now.publicKey) ===
              offer.index
            ) {
              return { ...now, walletKeyIndex: offer.index };
            }
            throw new CardError('KEY_MISMATCH');
          }
          offer.reserve();
          return loadWalletKey(
            link,
            offer.mainPrivateKey,
            offer.index,
            defaultCardFlowDeps,
            { replace: true, applet: now.applet }
          );
        },
        { retries: 2 }
      );
      // Same card, same name and place in the list, new key and address.
      setLinked((all) => ({
        ...all,
        [address]: (all[address] ?? []).map((item) =>
          item.address === card.address
            ? {
                ...item,
                address: info.address,
                publicKey: Base58.encode(info.publicKey),
                applet: info.applet,
                walletKeyIndex: info.walletKeyIndex,
              }
            : item
        ),
      }));
      setForm(null);
      notify(card.address, null);
      notify(info.address, {
        tone: 'success',
        text: t('core:qortal_card.switch.done'),
      });
      void refresh([info.address]);
    } catch (error) {
      fail(card.address, error);
    } finally {
      prepared?.mainKey?.fill(0);
      setBusy(false);
    }
  };

  const rename = (card: LinkedCard, name: string) =>
    setLinked((all) => ({
      ...all,
      [address]: (all[address] ?? []).map((item) =>
        item.address === card.address
          ? { ...item, name: name || undefined }
          : item
      ),
    }));

  const remove = (card: LinkedCard) => {
    setForm(null);
    notify(card.address, null);
    setLinked((all) => ({
      ...all,
      [address]: (all[address] ?? []).filter(
        (item) => item.address !== card.address
      ),
    }));
  };

  const sentence = (key: string) =>
    t(key, { postProcess: 'capitalizeFirstChar' });

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {topNotice && (
        <Box
          role={topNotice.tone === 'error' ? 'alert' : 'status'}
          sx={noteSx(theme, topNotice.tone)}
        >
          {topNotice.text}
        </Box>
      )}

      {needsWallet !== null && (
        <Box sx={{ ...surfaceSx(theme), display: 'grid', gap: 1 }}>
          <Typography sx={{ fontWeight: 750 }}>
            {t('core:qortal_card.connect.blank_title')}
          </Typography>
          <Typography sx={hintSx(theme)}>
            {needsWallet
              ? t('core:qortal_card.connect.needs_wallet', {
                  reason: needsWallet,
                })
              : t('core:qortal_card.connect.needs_wallet_plain')}
          </Typography>
          <Button
            disabled={busy || !nfcReady}
            onClick={() => void connect()}
            variant="contained"
          >
            {t('core:qortal_card.pay.try_again')}
          </Button>
          <Button
            disabled={busy || !nfcReady}
            onClick={() => void makeOwnKey()}
            startIcon={<KeyRoundedIcon />}
            variant="outlined"
          >
            {t('core:qortal_card.setup.card')}
          </Button>
          <Typography sx={hintSx(theme)}>
            {t('core:qortal_card.setup.card_hint')}
          </Typography>
          <Button disabled={busy} onClick={() => setNeedsWallet(null)}>
            {sentence('core:action.cancel')}
          </Button>
        </Box>
      )}

      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        <Typography sx={{ ...labelSx(theme), flex: 1 }}>
          {t('core:qortal_card.card.list_title')}
        </Typography>
        {cards.length > 0 && (
          <IconButton
            aria-label={sentence('core:action.refresh')}
            onClick={() => void refresh()}
            size="small"
          >
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {cards.length === 0 && (
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.card.empty')}
        </Typography>
      )}

      {cards.map((card, position) => (
        <CardItem
          busy={busy}
          card={card}
          form={form?.address === card.address ? form : null}
          key={card.address}
          nfcReady={nfcReady}
          notice={notices[card.address] ?? null}
          onBackup={(password) => backup(card, password)}
          onConfirmMove={(amount) => void confirmMove(card, amount)}
          onDismissNotice={() => notify(card.address, null)}
          onForm={(mode: CardFormMode | null) =>
            setForm(mode ? { address: card.address, mode } : null)
          }
          onPrepareMove={() => void prepareMove(card)}
          onPrepareSwitch={() => void prepareSwitch(card)}
          onSwitchLoad={() => void switchLoad(card)}
          onSwitchMove={() => void switchMove(card)}
          onPublishAvatar={(file, fee) => void publishAvatar(card, file, fee)}
          onRegisterName={(name, fee) => void registerName(card, name, fee)}
          onRemove={() => remove(card)}
          onRename={(name) => rename(card, name)}
          onTopUp={() => topUp(card)}
          position={position}
          registering={registering[card.address] ?? null}
          state={states[card.address]}
          updating={watching.has(card.address)}
        />
      ))}

      <Button
        disabled={!nfcReady || busy}
        onClick={() => void connect()}
        startIcon={<AddCardRoundedIcon />}
        sx={{ mt: 0.5, py: 1.2 }}
        variant="contained"
      >
        {t('core:qortal_card.card.connect')}
      </Button>
      <Typography sx={hintSx(theme)}>
        {t('core:qortal_card.card.connect_how')}{' '}
        {t('core:qortal_card.card.connect_hint', {
          address: shortAddress(address),
        })}
      </Typography>
    </Box>
  );
}
