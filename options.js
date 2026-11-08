// Настройки живут на самом сайте FunPay (адрес с #helper). Эта страница просто ведёт туда.
chrome.tabs.getCurrent((tab) => {
  const url = "https://funpay.com/#helper";
  if (tab?.id) chrome.tabs.update(tab.id, { url });
  else location.href = url;
});
