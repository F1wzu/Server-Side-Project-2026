// Admin: activity history (src/models/activity.js). The page and the API call
// the same model function.
const activityModel = require('../models/activity');

// Thai labels, by kind of entry and by group.
const KIND_LABELS = {
  member_joined: 'สมัครสมาชิก',
  member_suspended: 'ระงับบัญชีสมาชิก',
  member_unsuspended: 'ยกเลิกการระงับบัญชี',
  submission_submitted: 'ส่งคำขอแนะนำสถานที่',
  submission_edited: 'แก้ไขคำขอ',
  submission_resubmitted: 'ส่งคำขออีกครั้ง',
  submission_returned: 'ส่งคำขอกลับให้แก้',
  submission_approved: 'อนุมัติคำขอ',
  submission_rejected: 'ปฏิเสธคำขอ',
  place_added: 'เพิ่มสถานที่โดยตรง',
  review_posted: 'เขียนรีวิว',
  review_removed: 'ลบรีวิว',
  reply_posted: 'ตอบกลับรีวิว',
  reply_removed: 'ลบคำตอบกลับ',
  place_reported: 'แจ้งข้อมูลผิด',
  place_report_resolved: 'ปิดรายการแจ้งข้อมูลผิด (แก้ไขแล้ว)',
  place_report_dismissed: 'ปิดรายการแจ้งข้อมูลผิด (ไม่ดำเนินการ)',
  review_reported: 'รายงานรีวิว',
  review_report_resolved: 'ปิดรายงานรีวิว (ดำเนินการแล้ว)',
  review_report_dismissed: 'ปิดรายงานรีวิว (ไม่ดำเนินการ)',
};
const GROUP_LABELS = {
  all: 'ทั้งหมด',
  members: 'สมาชิก',
  submissions: 'คำขอ',
  places: 'สถานที่',
  reviews: 'รีวิว',
  reports: 'การแจ้ง',
};

// Only a known group and a sane page number are used.
const groupFrom = (value) => (activityModel.GROUPS.includes(value) ? value : 'all');
function pageFrom(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}
const listUrl = (group, page) => {
  const query = new URLSearchParams();
  if (group !== 'all') query.set('group', group);
  if (page > 1) query.set('page', String(page));
  const text = query.toString();
  return '/admin/activity' + (text ? '?' + text : '');
};

// GET /admin/activity
async function page(req, res) {
  const group = groupFrom(req.query.group);
  const result = await activityModel.list({ group, page: pageFrom(req.query.page) });
  res.render('admin/activity', {
    title: 'บันทึกกิจกรรม',
    result,
    group,
    groups: activityModel.GROUPS.map((key) => ({ key, label: GROUP_LABELS[key], href: listUrl(key, 1) })),
    kindLabels: KIND_LABELS,
    pageLink: (number) => listUrl(group, number),
  });
}

// GET /api/v1/admin/activity?group=&page=
async function apiList(req, res) {
  const { data, pagination } = await activityModel.list({ group: groupFrom(req.query.group), page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

module.exports = { page, apiList, KIND_LABELS };
