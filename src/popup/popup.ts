// Popup dashboard: plan + weekly usage, upgrade/manage/restore, and Pro-only
// settings (merged PDF, naming templates). Talks to the background for
// licensing; reads/writes usage + settings from chrome.storage.
import { getLicense, openLoginPage, openPaymentPage, openTrialPage } from '@/lib/license';
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
  trial: $<HTMLButtonElement>('trial'),
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
  // Hide everything conditional up front, then switch on state.
  els.usage.hidden = true;
  els.trial.hidden = true;
  els.upgrade.hidden = true;
  els.manage.hidden = true;
  els.restore.hidden = true;

  if (license.paid) {
    els.badge.textContent = 'Pro';
    els.badge.className = 'badge badge-pro';
    const kind = license.plan === 'one-time' ? 'One-time unlock' : 'Subscription';
    const status = license.status && license.status !== 'active' ? ` · ${license.status}` : '';
    els.detail.textContent = `${kind}${status} · unlimited, all features`;
    els.manage.hidden = false;
    return;
  }

  if (license.trialActive) {
    els.badge.textContent = 'Pro trial';
    els.badge.className = 'badge badge-trial';
    const d = license.trialDaysLeft;
    els.detail.textContent = `${d} day${d === 1 ? '' : 's'} left · unlimited, all features`;
    els.upgrade.hidden = false;
    els.upgrade.textContent = 'Upgrade to keep Pro';
    return;
  }

  // Free (trial expired or never started).
  els.badge.textContent = 'Free';
  els.badge.className = 'badge badge-free';
  els.detail.textContent = `PDF + Attachments · ${FREE_WEEKLY_EMAILS}/week`;
  els.usage.hidden = false;
  const pct = Math.min(100, Math.round((usage.count / FREE_WEEKLY_EMAILS) * 100));
  els.usageFill.style.width = `${pct}%`;
  els.usageFill.classList.toggle('full', usage.remaining === 0);
  els.usageText.textContent = `${usage.count} / ${FREE_WEEKLY_EMAILS} used · ${usage.remaining} left this week`;
  els.upgrade.hidden = false;
  els.upgrade.textContent = 'Upgrade to Pro';
  els.restore.hidden = false;
  // Offer the trial only if it was never started.
  els.trial.hidden = license.trialUsed;
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

  els.trial.addEventListener('click', () => void openTrialPage());
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
