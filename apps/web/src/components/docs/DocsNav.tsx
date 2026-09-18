import {
  BadgeDollarSign,
  Blocks,
  Bot,
  Boxes,
  ChevronDown,
  Coins,
  Database,
  ExternalLink,
  House,
  Image,
  KeyRound,
  LayoutDashboard,
  List,
  Map,
  MessageSquare,
  PanelTop,
  Plug,
  Puzzle,
  Radio,
  Rocket,
  Route,
  Search,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { GithubIcon } from "../BrandIcons";
import { cn } from "../../lib/cn";
import { GITHUB_REPO_URL } from "../../lib/social";
import {
  DOC_NAV,
  docPath,
  folderContainsPage,
  getDocPage,
  type DocIconName,
  type DocNavFolder,
  type DocPageId,
} from "../../content/docs/sections";

const ICONS: Record<DocIconName, LucideIcon> = {
  home: House,
  rocket: Rocket,
  plug: Plug,
  puzzle: Puzzle,
  database: Database,
  bot: Bot,
  key: KeyRound,
  wallet: Wallet,
  coins: Coins,
  message: MessageSquare,
  image: Image,
  search: Search,
  radio: Radio,
  route: Route,
  panel: PanelTop,
  shield: ShieldCheck,
  boxes: Boxes,
  "badge-dollar": BadgeDollarSign,
  list: List,
  map: Map,
};

const itemBase =
  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-body-sm outline-none transition-colors duration-base ease-standard focus-visible:shadow-focus";

function PageLink({
  id,
  activeId,
  nested = false,
  onNavigate,
}: {
  id: DocPageId;
  activeId: DocPageId;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const page = getDocPage(id);
  const Icon = ICONS[page.icon];
  const active = id === activeId;

  return (
    <NavLink
      to={docPath(id)}
      onClick={onNavigate}
      className={cn(
        itemBase,
        nested && "pl-9",
        active
          ? "bg-on-surface font-medium text-background"
          : "text-on-surface-muted hover:bg-surface hover:text-on-surface",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 truncate">{page.label}</span>
    </NavLink>
  );
}

function FolderItem({
  folder,
  activeId,
  onNavigate,
}: {
  folder: DocNavFolder;
  activeId: DocPageId;
  onNavigate?: () => void;
}) {
  const childActive = folderContainsPage(folder, activeId);
  const [open, setOpen] = useState(childActive);
  const Icon = folder.icon === "plug" ? Blocks : ICONS[folder.icon];

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <div>
      <button
        type="button"
        className={cn(
          itemBase,
          childActive && !open
            ? "text-on-surface"
            : "text-on-surface-muted hover:bg-surface hover:text-on-surface",
        )}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{folder.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-base ease-standard",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div className="mt-0.5 space-y-0.5">
          {folder.children.map((id) => (
            <PageLink
              key={id}
              id={id}
              activeId={activeId}
              nested
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocsNav({
  activeId,
  onNavigate,
}: {
  activeId: DocPageId;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Documentation">
      <div className="space-y-0.5">
        <Link
          to="/console/overview"
          onClick={onNavigate}
          className={cn(itemBase, "text-on-surface-muted hover:bg-surface hover:text-on-surface")}
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Developer Console
        </Link>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className={cn(itemBase, "text-on-surface-muted hover:bg-surface hover:text-on-surface")}
        >
          <GithubIcon className="h-4 w-4 shrink-0" />
          GitHub
          <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-60" strokeWidth={1.75} />
        </a>
      </div>

      {DOC_NAV.map((group) => (
        <div key={group.label} className="mt-6">
          <p className="mb-1.5 px-3 text-label-sm text-on-surface-faint">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) =>
              item.type === "folder" ? (
                <FolderItem
                  key={item.id}
                  folder={item}
                  activeId={activeId}
                  onNavigate={onNavigate}
                />
              ) : (
                <PageLink
                  key={item.id}
                  id={item.id}
                  activeId={activeId}
                  onNavigate={onNavigate}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </nav>
  );
}
