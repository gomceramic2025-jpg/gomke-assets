import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const go = async (page: Page, route: string) => { await page.goto(`/#/${route}`); await expect(page.locator('h1').first()).toBeVisible(); };
const cat = (p: Page) => p.getByRole('dialog').locator('label.field', { has: p.locator('span', { hasText: /^Danh mục$/ }) }).locator('select');
const isMobile = (p: Page) => (p.viewportSize()?.width ?? 1000) < 800;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
});

test('chế độ cục bộ: nói rõ chưa cấu hình đồng bộ, không có đăng nhập giả', async ({ page }) => {
  await go(page, 'dong-bo');
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay' })).toBeDisabled();
  await expect(page.getByText('Đồng bộ trực tuyến chưa được cấu hình')).toBeVisible();
  await expect(page.getByText('chưa có gì được đồng bộ sang iPhone')).toBeVisible();
  await go(page, 'dang-nhap');
  await expect(page.getByText('Chưa cấu hình đồng bộ trực tuyến')).toBeVisible();
  await expect(page.getByRole('button', { name: /Đăng nhập bằng Google/ })).toHaveCount(0);
});

test('nhập giao dịch đầu tiên bằng tay → tổng quan hiện số đúng; chuyển tiền không thành thu/chi', async ({ page }) => {
  await go(page, 'giao-dich');
  await expect(page.getByText('Chưa có giao dịch')).toBeVisible();
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByRole('radio', { name: 'Thu nhập' }).click();
  await page.getByLabel('Số tiền (VND)').fill('10.000.000');
  await cat(page).selectOption({ label: 'Tiền nhận từ Gốm Kể' });
  await page.getByLabel('Nội dung').fill('Lương tháng');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('cell', { name: 'Lương tháng' })).toBeVisible();
  // chi
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('1.500.000');
  await cat(page).selectOption({ label: 'Sinh hoạt' });
  await page.getByRole('button', { name: 'Lưu' }).click();
  // chuyển tiền nội bộ
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByRole('radio', { name: 'Chuyển tiền' }).click();
  await page.getByLabel('Số tiền (VND)').fill('2.000.000');
  await page.getByLabel('Đến tài khoản').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('cell', { name: 'Chuyển tiền' })).toBeVisible();
  await go(page, 'tong-quan');
  await expect(page.locator('.stat', { hasText: 'Số dư tiền' }).locator('.value')).toContainText('8.500.000');
  await expect(page.locator('.stat', { hasText: 'Thu nhập' }).locator('.value')).toContainText('10.000.000');
  await expect(page.locator('.stat', { hasText: 'Chi phí' }).locator('.value')).toContainText('1.500.000');
});

test('kiểm tra biểu mẫu: số tiền sai / thiếu bị chặn có thông báo', async ({ page }) => {
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('1,5');
  await page.getByLabel('Số tiền (VND)').blur();
  await expect(page.getByRole('alert').first()).toContainText('số nguyên đồng');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dữ liệu mẫu: có nhãn, tính ra số liệu, xóa riêng sạch', async ({ page }) => {
  await go(page, 'cai-dat');
  await page.getByRole('button', { name: 'Nạp dữ liệu mẫu để thử' }).click();
  await expect(page.getByRole('button', { name: 'Xóa toàn bộ dữ liệu mẫu' })).toBeVisible();
  await go(page, 'tong-quan');
  await expect(page.getByText('Đang có dữ liệu MẪU')).toBeVisible();
  await go(page, 'giao-dich');
  await expect(page.getByText('Mẫu · không đồng bộ').first()).toBeVisible();
  await go(page, 'cai-dat');
  await page.getByRole('button', { name: 'Xóa toàn bộ dữ liệu mẫu' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa dữ liệu mẫu' }).click();
  await expect(page.getByRole('button', { name: 'Nạp dữ liệu mẫu để thử' })).toBeVisible();
  await go(page, 'giao-dich');
  await expect(page.getByText('Chưa có giao dịch')).toBeVisible();
});

test('thùng rác: xóa → khôi phục → xóa vĩnh viễn cần xác nhận riêng; lịch sử ghi lại', async ({ page }) => {
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('50000');
  await cat(page).selectOption({ label: 'Sinh hoạt' });
  await page.getByLabel('Nội dung').fill('Cà phê thử');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await page.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Chuyển vào thùng rác' }).last().click();
  await expect(page.getByText('Chưa có giao dịch')).toBeVisible();
  await page.getByRole('tab', { name: /Thùng rác/ }).click();
  await expect(page.getByRole('cell', { name: 'Cà phê thử' })).toBeVisible();
  await page.getByRole('button', { name: 'Khôi phục' }).click();
  await page.getByRole('tab', { name: /Giao dịch \(/ }).click();
  await expect(page.getByRole('cell', { name: 'Cà phê thử' })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Chuyển vào thùng rác' }).last().click();
  await page.getByRole('tab', { name: /Thùng rác/ }).click();
  await page.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
  await expect(page.getByRole('dialog').getByText('Không thể hoàn tác')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
  await page.getByRole('tab', { name: 'Lịch sử thao tác' }).click();
  await expect(page.getByText('Xóa vĩnh viễn transactions')).toBeVisible();
  await expect(page.getByText('Khôi phục transactions từ thùng rác')).toBeVisible();
});

test('nhập sao kê CSV: xem trước → phát hiện lỗi/trùng → chỉ ghi sau khi xác nhận → hoàn tác lô', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'imp-'));
  const file = join(dir, 'sao-ke.csv');
  writeFileSync(file, 'Ngày giao dịch,Diễn giải,Ghi nợ,Ghi có,Mã GD\n05/03/2026,Thanh toan Highlands Coffee,"45.000",,FT001\n06/03/2026,Nhan tien tu Gom Ke,,"8.000.000",FT002\n07/03/2026,Dong sai,abc,,FT003\n', 'utf8');
  await go(page, 'nhap-sao-ke');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByText('Đã nhận diện cột')).toBeVisible();
  await page.getByRole('button', { name: 'Xem trước' }).click();
  await expect(page.getByText('Không đọc được số tiền')).toBeVisible();
  await expect(page.getByLabel('Nhập dòng 4')).toBeDisabled();
  // chưa ghi gì
  await go(page, 'giao-dich');
  await expect(page.getByText('Chưa có giao dịch')).toBeVisible();
  await go(page, 'nhap-sao-ke');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Xem trước' }).click();
  await page.getByRole('button', { name: /Nhập 2 giao dịch/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Xác nhận ghi vào sổ chính thức');
  await page.getByRole('button', { name: 'Ghi 2 giao dịch' }).click();
  await expect(page.getByText('Đã ghi 2 giao dịch')).toBeVisible();
  await go(page, 'giao-dich');
  await expect(page.getByRole('cell', { name: /Nhan tien tu Gom Ke/ })).toBeVisible();
  // nhập lại cùng tệp → nghi trùng, mặc định không nhập
  await go(page, 'nhap-sao-ke');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Xem trước' }).click();
  await expect(page.getByText('Rất có thể trùng').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Nhập 0 giao dịch/ })).toBeDisabled();
});

test('nhập tệp sai định dạng / rỗng → thông báo lỗi rõ', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'imp-'));
  const bad = join(dir, 'x.docx'); writeFileSync(bad, 'abc');
  await go(page, 'nhap-sao-ke');
  await page.locator('input[type=file]').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('Không hỗ trợ');
  const empty = join(dir, 'e.csv'); writeFileSync(empty, '');
  await page.locator('input[type=file]').setInputFiles(empty);
  await expect(page.getByRole('alert')).toContainText('rỗng');
});

test('ngân sách + mục tiêu: không phân bổ vượt số tiền đang có', async ({ page }) => {
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByRole('radio', { name: 'Thu nhập' }).click();
  await page.getByLabel('Số tiền (VND)').fill('1.000.000');
  await cat(page).selectOption({ label: 'Thu nhập khác' });
  await page.getByRole('button', { name: 'Lưu' }).click();
  await go(page, 'ngan-sach');
  await page.getByRole('row', { name: /Sinh hoạt/ }).getByRole('textbox').fill('2.000.000');
  await page.getByRole('button', { name: 'Lưu ngân sách Sinh hoạt' }).click();
  await expect(page.getByText('Chưa đủ dữ liệu để đề xuất đáng tin cậy')).toBeVisible();
  await go(page, 'muc-tieu');
  await expect(page.getByText('Thực tế ≠ dự kiến')).toBeVisible();
  await expect(page.getByText('Chưa đủ dữ liệu để dự báo theo kịch bản')).toBeVisible();
  await page.getByRole('region', { name: 'Quỹ dự phòng cá nhân' }).getByRole('button', { name: 'Phân bổ tiền' }).click();
  await page.getByRole('dialog').getByLabel('Số tiền').fill('1.500.000');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Chỉ còn');
  await page.getByRole('dialog').getByLabel('Số tiền').fill('600.000');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('dialog').getByRole('cell', { name: /\+600\.000/ })).toBeVisible();
});

test('tạo khóa khôi phục: cảnh báo hậu quả mất khóa, bắt buộc xác nhận đã lưu, khóa không được lưu lại', async ({ page }) => {
  await go(page, 'dong-bo');
  await page.getByRole('button', { name: 'Tạo khóa mã hóa' }).click();
  await expect(page.getByText('Khóa này chỉ hiện MỘT lần')).toBeVisible();
  const key = (await page.getByTestId('recovery-key').textContent())!.trim();
  expect(key).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  await expect(page.getByRole('button', { name: 'Tôi đã lưu — đóng' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Tôi đã lưu khóa/ }).check();
  await page.getByRole('button', { name: 'Tôi đã lưu — đóng' }).click();
  await expect(page.getByText('Thiết bị này đã có khóa')).toBeVisible();
  // khóa khôi phục không nằm trong bất kỳ kho lưu trữ nào của trình duyệt
  const stored = await page.evaluate(async () => {
    const dump: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      const db: IDBDatabase = await new Promise((res) => { const r = indexedDB.open(d.name!); r.onsuccess = () => res(r.result); });
      for (const name of Array.from(db.objectStoreNames)) {
        if (name === 'keyring') continue; // CryptoKey không thể serialize
        const rows: unknown[] = await new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
        dump.push(JSON.stringify(rows));
      }
    }
    return dump.join('\n');
  });
  expect(stored).not.toContain(key.replace(/-/g, ''));
  expect(stored).not.toContain(key);
});

test('sao lưu → khôi phục: tải tệp mã hóa, xem thông tin trước khi xác nhận, dữ liệu trở lại', async ({ page }) => {
  await go(page, 'dong-bo');
  await page.getByRole('button', { name: 'Tạo khóa mã hóa' }).click();
  await page.getByRole('checkbox', { name: /Tôi đã lưu khóa/ }).check();
  await page.getByRole('button', { name: 'Tôi đã lưu — đóng' }).click();
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('123456');
  await cat(page).selectOption({ label: 'Sinh hoạt' });
  await page.getByLabel('Nội dung').fill('Bí mật xyz');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await go(page, 'sao-luu');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sao lưu ngay' }).click()]);
  const path = await dl.path();
  const text = readFileSync(path!, 'utf8');
  expect(text).not.toContain('Bí mật xyz');
  expect(JSON.parse(text).encrypted).toBe(true);
  await expect(page.getByText('Thành công, đã kiểm tra').first()).toBeVisible();
  // xóa giao dịch rồi khôi phục từ tệp
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Chuyển vào thùng rác' }).last().click();
  await go(page, 'sao-luu');
  const f = join(mkdtempSync(join(tmpdir(), 'bk-')), 'b.gomke-fin'); writeFileSync(f, text);
  await page.locator('input[type=file]').setInputFiles(f);
  await expect(page.getByRole('dialog')).toContainText('Đã mã hóa');
  await expect(page.getByRole('dialog')).toContainText('Giao dịch: 1');
  await page.getByRole('button', { name: 'Thay thế dữ liệu hiện tại' }).click();
  await expect(page.getByText('Đã khôi phục')).toBeVisible();
  await go(page, 'giao-dich');
  await expect(page.getByRole('cell', { name: 'Bí mật xyz' })).toBeVisible();
  // tệp hỏng bị từ chối, dữ liệu giữ nguyên
  const bad = join(mkdtempSync(join(tmpdir(), 'bk-')), 'bad.gomke-fin'); writeFileSync(bad, text.slice(0, 200));
  await go(page, 'sao-luu');
  await page.locator('input[type=file]').setInputFiles(bad);
  await expect(page.getByText('không phải JSON hợp lệ').first()).toBeVisible();
});

test('Google Drive chưa cấu hình: báo rõ, không giả vờ kết nối', async ({ page }) => {
  await go(page, 'sao-luu');
  await expect(page.getByText('Chưa cấu hình VITE_GOOGLE_CLIENT_ID')).toBeVisible();
});

test('trợ lý: phân tích quy tắc nói rõ không phải AI; AI tắt mặc định', async ({ page }) => {
  await go(page, 'tro-ly');
  await expect(page.getByText('không phải AI tạo sinh')).toBeVisible();
  await expect(page.getByText('AI đang tắt')).toBeVisible();
});

test('báo cáo: xuất CSV có BOM và chống công thức; mở được 3 loại báo cáo', async ({ page }) => {
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('1000');
  await cat(page).selectOption({ label: 'Sinh hoạt' });
  await page.getByLabel('Nội dung').fill('=HYPERLINK("http://x")');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await go(page, 'bao-cao');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất CSV' }).click()]);
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  await page.getByRole('tab', { name: 'Báo cáo năm' }).click();
  await expect(page.getByRole('heading', { name: /^Năm / })).toBeVisible();
  await page.getByRole('tab', { name: 'Dòng tiền' }).click();
  await expect(page.getByText('Số dư cuối kỳ').first()).toBeVisible();
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất Excel' }).click()]);
  expect((await x.suggestedFilename())).toMatch(/\.xlsx$/);
});

test('bố cục: không cuộn ngang; điều hướng phù hợp màn hình; mọi trang có tiêu đề và mở được', async ({ page }) => {
  const routes = ['tong-quan', 'giao-dich', 'nhap-sao-ke', 'ngan-sach', 'muc-tieu', 'tai-san', 'bao-cao', 'dong-bo', 'sao-luu', 'cai-dat', 'tro-ly', 'dang-nhap'];
  for (const r of routes) {
    await go(page, r);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `trang ${r} cuộn ngang`).toBeLessThanOrEqual(1);
  }
  if (isMobile(page)) { await expect(page.locator('.bottom-nav')).toBeVisible(); await expect(page.locator('.nav')).toBeHidden(); await page.getByRole('button', { name: 'Thêm' }).click(); await expect(page.getByRole('link', { name: /Sao lưu/ })).toBeVisible(); }
  else { await expect(page.locator('.nav')).toBeVisible(); await expect(page.locator('.bottom-nav')).toBeHidden(); }
});

test('bàn phím: Tab tới nút đầu tiên và có viền focus; mọi nút có tên', async ({ page }) => {
  await go(page, 'giao-dich');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(['A', 'BUTTON', 'INPUT']).toContain(focused);
  const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('button, a, input, select')).filter((e) => {
    const el = e as HTMLElement; if (el.offsetParent === null) return false;
    return !(el.getAttribute('aria-label') || el.textContent?.trim() || (el as HTMLInputElement).placeholder || el.id && document.querySelector(`label[for="${el.id}"]`) || el.closest('label'));
  }).map((e) => e.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);
});

test('PWA: có manifest, icon, service worker; mở lại được khi ngoại tuyến', async ({ page, context }) => {
  const m = await (await page.request.get('/manifest.webmanifest')).json();
  expect(m.display).toBe('standalone'); expect(m.lang).toBe('vi');
  for (const icon of m.icons.filter((i: { type: string }) => i.type === 'image/png')) expect((await page.request.get(icon.src)).ok()).toBe(true);
  expect((await page.request.get('/apple-touch-icon.png')).ok()).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  await go(page, 'giao-dich');
  await page.getByRole('button', { name: '+ Thêm giao dịch' }).click();
  await page.getByLabel('Số tiền (VND)').fill('777000');
  await cat(page).selectOption({ label: 'Sinh hoạt' });
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('cell', { name: /777\.000/ })).toBeVisible(); // ghi cục bộ khi mất mạng
  await context.setOffline(false);
});
