// You can replace this with an API call later (e.g., axios.get('https://api.exchangerate-api.com...'))
const RATES = {
  USD: 1,
  NGN: 1500, // $1 = ₦1500
  GBP: 0.79, // $1 = £0.79
  EUR: 0.92, // $1 = €0.92
  KES: 130,  // $1 = KSh 130
  GHS: 12    // $1 = ₵12
};

export const getRate = (currency) => {
  return RATES[currency?.toUpperCase()] || 1; // Default to 1 (USD) if unknown
};

export const convertFromUSD = (amountUSD, targetCurrency) => {
  const rate = getRate(targetCurrency);
  return (amountUSD * rate).toFixed(2);
};

export const convertToUSD = (amountLocal, fromCurrency) => {
  const rate = getRate(fromCurrency);
  return (amountLocal / rate).toFixed(2);
};