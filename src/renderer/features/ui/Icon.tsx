import React from 'react'
import {
  AlignJustify, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpToLine,
  BookOpen, Bookmark, Boxes, Braces, Bug, Check, CheckCheck, ChevronDown, ChevronsDown, ChevronsDownUp,
  ChevronsUp, ChevronsUpDown, Circle, CircleAlert, CircleArrowUp, CircleCheck, CircleHelp, CircleMinus,
  CircleUser, Cloud, Code, Copy, CopyPlus, CornerDownRight, Delete, Download, Ellipsis, ExternalLink,
  Eye, EyeOff, File, FileDiff, FileDown, FileSearch, FileText, Folder, FolderArchive, FolderInput, FolderOpen, FolderPlus,
  Gamepad2, Hexagon, History, Image as ImageIcon, Info, Key, Languages, Layers, Link as LinkIcon,
  List, ListChecks, LoaderCircle, Lock, Mail, Menu, Minus, Monitor, MonitorDown, Moon, Network, Package, PackageOpen, Palette,
  Pause, Pencil, Pipette, Play, Plus, Power, RefreshCw, RotateCcw, Search, SearchX, Settings, Shapes,
  Shield, SlidersHorizontal, Sparkles, Square, SquareCheck, Star, Sun, Tag, Terminal, ToggleRight, TriangleAlert,
  Trash2, Upload, User, Users, Webhook, X, Zap,
  type LucideIcon,
} from 'lucide-react'

// Central icon registry: maps the (legacy Material Symbols) name strings still used across the
// app to real HeroUI-consistent Lucide icons. Rendered at 1em so the existing `text-[Npx]`
// sizing + `text-[color]` classes keep controlling size/color exactly as before - no call site
// needs to change how it sizes/colors icons. Do NOT reintroduce the Material Symbols font.
const ICONS: Record<string, LucideIcon> = {
  arrow_back: ArrowLeft,
  arrow_forward: ArrowRight,
  arrow_downward: ArrowDown,
  arrow_upward: ArrowUp,
  auto_awesome: Sparkles,
  autorenew: RefreshCw,
  backspace: Delete,
  bolt: Zap,
  bookmark: Bookmark,
  bug_report: Bug,
  category: Shapes,
  check: Check,
  check_box_outline_blank: Square,
  check_circle: CircleCheck,
  checkbox: SquareCheck,
  close: X,
  cloud: Cloud,
  cloud_sync: RefreshCw,
  code: Code,
  colorize: Pipette,
  content_copy: Copy,
  create: Pencil,
  create_new_folder: FolderPlus,
  data_object: Braces,
  delete: Trash2,
  delete_forever: Trash2,
  delete_sweep: Trash2,
  dark_mode: Moon,
  desktop_windows: Monitor,
  deployed_code: Package,
  deployed_code_history: PackageOpen,
  description: FileText,
  difference: FileDiff,
  do_not_disturb_on: CircleMinus,
  done_all: CheckCheck,
  download: Download,
  download_for_offline: Download,
  downloading: Download,
  edit: Pencil,
  error: CircleAlert,
  expand_more: ChevronDown,
  file: File,
  file_download: FileDown,
  folder: Folder,
  folder_open: FolderOpen,
  folder_special: Folder,
  folder_zip: FolderArchive,
  groups: Users,
  help: CircleHelp,
  help_outline: CircleHelp,
  hexagon: Hexagon,
  history: History,
  hub: Network,
  info: Info,
  install_desktop: MonitorDown,
  // Package (single box) instead of Boxes: the three-box glyph packs far more stroke than
  // the gear/download icons beside it in the sidebar, so it optically read as "more black".
  inventory_2: Package,
  key: Key,
  keyboard_double_arrow_down: ChevronsDown,
  keyboard_double_arrow_up: ChevronsUp,
  label: Tag,
  language: Languages,
  layers: Layers,
  library_add: CopyPlus,
  light_mode: Sun,
  link: LinkIcon,
  list: List,
  lock: Lock,
  mail: Mail,
  manage_search: FileSearch,
  menu: Menu,
  menu_book: BookOpen,
  more_horiz: Ellipsis,
  move_item: FolderInput,
  new_releases: Sparkles,
  open_in_browser: ExternalLink,
  open_in_new: ExternalLink,
  palette: Palette,
  pause: Pause,
  person: User,
  photo: ImageIcon,
  image: ImageIcon,
  play_arrow: Play,
  power_settings_new: Power,
  priority_high: TriangleAlert,
  progress_activity: LoaderCircle,
  radio_button_unchecked: Circle,
  refresh: RefreshCw,
  remove: Minus,
  restart_alt: RotateCcw,
  rule: ListChecks,
  search: Search,
  search_off: SearchX,
  segment: AlignJustify,
  settings: Settings,
  settings_backup_restore: RotateCcw,
  shield: Shield,
  sort: ArrowUpDown,
  sports_esports: Gamepad2,
  star: Star,
  subdirectory_arrow_right: CornerDownRight,
  sync: RefreshCw,
  task_alt: CircleCheck,
  terminal: Terminal,
  toggle_on: ToggleRight,
  tune: SlidersHorizontal,
  unfold_less: ChevronsDownUp,
  unfold_more: ChevronsUpDown,
  update: RefreshCw,
  upgrade: CircleArrowUp,
  upload: Upload,
  vertical_align_top: ArrowUpToLine,
  visibility: Eye,
  visibility_off: EyeOff,
  vpn_key: Key,
  warning: TriangleAlert,
  account_circle: CircleUser,
  api: Webhook,
  article: FileText,
  add: Plus,
}

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  name: string
  className?: string
}

// Renders a Lucide icon by its legacy name. Size/color come from the className (`text-[18px]`
// sets the font-size → 1em; `text-[color]` sets currentColor), matching how the old font icons
// worked, so it's a drop-in for `<Icon name="name" className="…" />`.
export const Icon: React.FC<IconProps> = ({ name, className, style, ...rest }) => {
  const Cmp = ICONS[name] ?? Square
  return (
    <Cmp
      aria-hidden="true"
      className={className}
      style={{ width: '1em', height: '1em', ...style }}
      strokeWidth={2}
      {...rest}
    />
  )
}
