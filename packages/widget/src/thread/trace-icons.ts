import type { FC, SVGProps } from "react";
import {
  AppWindowIcon,
  ArchiveIcon,
  ArrowDownLeftIcon,
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  BanIcon,
  BlocksIcon,
  BookOpenIcon,
  BotIcon,
  BracesIcon,
  CableIcon,
  CircleCheckIcon,
  CircleDollarSignIcon,
  CircleXIcon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  FileCode2Icon,
  FileTextIcon,
  FlameIcon,
  FlaskConicalIcon,
  FuelIcon,
  GlobeIcon,
  HashIcon,
  HistoryIcon,
  LandmarkIcon,
  LayersIcon,
  ListIcon,
  ListOrderedIcon,
  NetworkIcon,
  PencilLineIcon,
  PenLineIcon,
  PercentIcon,
  PuzzleIcon,
  ReceiptTextIcon,
  ScissorsIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TagIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UserIcon,
  WalletIcon,
  WrenchIcon,
} from "lucide-react";
import type { TraceGlyph, TraceIcon } from "@aomi-labs/client/trace";

import { getAppIcon } from "@/icons/app-map";
import { getChainIcon } from "@/icons/chain-map";
import { SolanaIcon } from "@/icons/chain-icons";
import { getSkillIcon } from "@/icons/skills/skill-icons";

type Icon = FC<SVGProps<SVGSVGElement>>;

const GLYPHS: Record<TraceGlyph, Icon> = {
  agent: BotIcon,
  allowance: PenLineIcon,
  app: AppWindowIcon,
  approve: PencilLineIcon,
  archive: ArchiveIcon,
  block: BlocksIcon,
  blocked: BanIcon,
  bridge: CableIcon,
  burn: FlameIcon,
  code: BracesIcon,
  coins: CoinsIcon,
  contract: FileCode2Icon,
  copies: CopyIcon,
  dollar: CircleDollarSignIcon,
  failed: CircleXIcon,
  gas: FuelIcon,
  globe: GlobeIcon,
  hash: HashIcon,
  history: HistoryIcon,
  incoming: ArrowDownLeftIcon,
  layers: LayersIcon,
  list: ListIcon,
  network: NetworkIcon,
  outgoing: ArrowUpRightIcon,
  page: FileTextIcon,
  pending: ClockIcon,
  percent: PercentIcon,
  protocol: LandmarkIcon,
  ranked: ListOrderedIcon,
  read: BookOpenIcon,
  receipt: ReceiptTextIcon,
  search: SearchIcon,
  send: SendIcon,
  sign: PenLineIcon,
  simulate: FlaskConicalIcon,
  skill: SparklesIcon,
  solana: SolanaIcon,
  success: CircleCheckIcon,
  swap: ArrowRightLeftIcon,
  tag: TagIcon,
  tool: WrenchIcon,
  trend: TrendingUpIcon,
  trim: ScissorsIcon,
  user: UserIcon,
  verified: BadgeCheckIcon,
  wallet: WalletIcon,
  warning: TriangleAlertIcon,
};

/** The Lucide icon or logo a trace icon key stands for. */
export const traceIcon = (key: TraceIcon): Icon => {
  const split = key.indexOf(":");
  if (split < 0) return GLYPHS[key as TraceGlyph];
  const id = key.slice(split + 1);
  switch (key.slice(0, split)) {
    case "chain":
      return getChainIcon(Number(id)) ?? NetworkIcon;
    case "app":
      return getAppIcon(id) ?? AppWindowIcon;
    default:
      return getSkillIcon(id) ?? PuzzleIcon;
  }
};
