// Popup dashboard: plan + weekly usage, upgrade/manage/restore, and Pro-only
// settings (merged PDF, naming templates). Talks to the background for
// licensing; reads/writes usage + settings from chrome.storage.
import { getLicense, openLoginPage, openPaymentPage } from '@/lib/license';
import { FREE_WEEKLY_EMAILS, getUsage } from '@/lib/usage';
import { getProSettings, setProSettings } from '@/lib/settings';
import type { LicenseInfo, ProSettings } from '@/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const els = {
  badge: $('plan-badge'),
  detail: $('plan-detail'),
  usage: $('usage'),
  usageFill: $<HTMLDivElement>('usage-fill'),
  usageText: $('usage-text'),
  upgrade: $<HTMLButtonElement>('upgrade'),
  manage: $<HTMLButtonElement>('manage'),
  restore: $<HTMLButtonElement>('restore'),
  pro: $('pro'),
  proNote: $('pro-note'),
  status: $('status'),
  pdfNameTemplate: $<HTMLInputElement>('pdfNameTemplate'),
  attachmentFolderTemplate: $<HTMLInputElement>('attachmentFolderTemplate'),
  zipFolderTemplate: $<HTMLInputElement>('zipFolderTemplate'),
};

const TEMPLATE_FIELDS = ['pdfNameTemplate', 'attachmentFolderTemplate', 'zipFolderTemplate'] as const;

function renderPlan(license: LicenseInfo, usage: { count: number; remaining: number }): void {
  if (license.pro) {
    els.badge.textContent = 'Pro';
    els.badge.className = 'badge badge-pro';
    const kind = license.plan === 'one-time' ? 'One-time unlock' : 'Subscription';
    const status = license.status && license.status !== 'active' ? ` · ${license.status}` : '';
    els.detail.textContent = `${kind}${status} · unlimited emails`;
    els.usage.hidden = true;
    els.upgrade.hidden = true;
    els.manage.hidden = false;
    els.restore.hidden = true;
  } else {
    els.badge.textContent = 'Free';
    els.badge.className = 'badge badge-free';
    els.detail.textContent = `${FREE_WEEKLY_EMAILS} emails / week`;
    els.usage.hidden = false;
    const pct = Math.min(100, Math.round((usage.count / FREE_WEEKLY_EMAILS) * 100));
    els.usageFill.style.width = `${pct}%`;
    els.usageFill.classList.toggle('full', usage.remaining === 0);
    els.usageText.textContent = `${usage.count} / ${FREE_WEEKLY_EMAILS} used · ${usage.remaining} left this week`;
    els.upgrade.hidden = false;
    els.manage.hidden = true;
    els.restore.hidden = false;
  }
}

function renderSettings(license: LicenseInfo, settings: ProSettings): void {
  els.pdfNameTemplate.value = settings.pdfNameTemplate;
  els.attachmentFolderTemplate.value = settings.attachmentFolderTemplate;
  els.zipFolderTemplate.value = settings.zipFolderTemplate;

  const locked = !license.pro;
  els.pro.classList.toggle('locked', locked);
  els.proNote.hidden = !locked;
  for (const id of TEMPLATE_FIELDS) els[id].disabled = locked;
}

async function refreshStatus(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isGmail = !!tab?.url && /^https:\/\/mail\.google\.com\//.test(tab.url);
  els.status.textContent = isGmail
    ? 'Gmail detected — use the toolbar buttons on selected emails.'
    : 'Open a Gmail tab to use the extractor.';
}

async function init(): Promise<void> {
  await refreshStatus();
  const [license, usage, settings] = await Promise.all([getLicense(), getUsage(), getProSettings()]);
  renderPlan(license, usage);
  renderSettings(license, settings);

  els.upgrade.addEventListener('click', () => void openPaymentPage());
  els.manage.addEventListener('click', () => void openPaymentPage());
  els.restore.addEventListener('click', () => void openLoginPage());

  // A locked Pro section routes clicks to the upsell instead of editing.
  els.pro.addEventListener('click', (e) => {
    if (els.pro.classList.contains('locked')) {
      e.preventDefault();
      void openPaymentPage();
    }
  });

  // Persist settings on change (inputs are disabled while free, so this only
  // fires for Pro users).
  for (const id of TEMPLATE_FIELDS) {
    els[id].addEventListener('change', () =>
      void setProSettings({ [id]: els[id].value.trim() } as Partial<ProSettings>),
    );
  }
}

void init();
