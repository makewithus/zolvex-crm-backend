const { getDashboardKPIs } = require('./src/services/dashboard.service');
getDashboardKPIs('Super Admin').then(res => {
  console.log('KPIs:', JSON.stringify(res.monthly_revenue_trend, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
