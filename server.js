const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const SECRET=process.env.JWT_SECRET||'change-me-in-production';
const db=new Database('gemstone.db');db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password TEXT,company TEXT);
CREATE TABLE IF NOT EXISTS gemstones(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,category TEXT,carat REAL,shape TEXT,color TEXT,origin TEXT,treatment TEXT,price REAL,stock INTEGER DEFAULT 1,certificate_no TEXT,status TEXT DEFAULT 'published',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER,customer TEXT,gemstone_id INTEGER,amount REAL,status TEXT DEFAULT 'Pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS certificates(number TEXT PRIMARY KEY,gemstone TEXT,weight TEXT,shape TEXT,color TEXT,origin TEXT,treatment TEXT,issued TEXT,laboratory TEXT);`);
if(!db.prepare('SELECT 1 FROM users').get()){
 const u=db.prepare('INSERT INTO users(email,password,company) VALUES(?,?,?)').run('admin@gems.lk',bcrypt.hashSync('admin123',10),'Colombo Gems (Pvt)').lastInsertRowid;
 const g=db.prepare('INSERT INTO gemstones(user_id,name,category,carat,shape,color,origin,treatment,price,stock,certificate_no) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 [['Ceylon Blue Sapphire','Sapphire',6.25,'Oval','Royal Blue','Sri Lanka','Heated',185000,1,'2235187654'],
  ['Padparadscha Sapphire','Sapphire',5.18,'Oval','Orange-Pink','Sri Lanka','Unheated',245000,2,'2235187655'],
  ['Ruby','Ruby',4.35,'Cushion','Vivid Red','Myanmar','Heated',165000,1,'2235187656'],
  ['Emerald','Emerald',3.80,'Emerald Cut','Green','Colombia','Oiled',95000,2,''],
  ['Yellow Sapphire','Sapphire',5.02,'Oval','Yellow','Sri Lanka','Heated',88000,3,''],
  ['Hessonite Garnet','Garnet',4.90,'Cushion','Orange-Red','Sri Lanka','None',38000,2,''],
  ["Cat's Eye Chrysoberyl","Cat's Eye",3.85,'Cabochon','Honey','Sri Lanka','None',72000,1,''],
  ['Spinel','Spinel',2.75,'Cushion','Red','Sri Lanka','None',26000,2,'']].forEach(r=>g.run(u,...r));
 const o=db.prepare('INSERT INTO orders(user_id,customer,gemstone_id,amount,status) VALUES(?,?,?,?,?)');
 [['Rohan Perera',1,185000,'Processing'],['Nimal Dissanayake',2,245000,'Shipped'],['Tharindu Silva',3,165000,'Delivered'],['Supun Fernando',4,95000,'Pending']].forEach(r=>o.run(u,...r));
 db.prepare('INSERT INTO certificates VALUES(?,?,?,?,?,?,?,?,?)').run('2235187654','Natural Blue Sapphire','6.25 Carat','Oval','Royal Blue','Sri Lanka','Heated','15 May 2025','GIA');
}
const app=express();app.use(express.json());app.use(express.static('public'));
const auth=(q,s,n)=>{try{q.user=jwt.verify((q.headers.authorization||'').slice(7),SECRET);n()}catch{s.status(401).json({error:'Please log in'})}};
const wrap=f=>(q,s)=>{try{f(q,s)}catch(e){s.status(400).json({error:e.message})}};
app.post('/api/login',wrap((q,s)=>{const u=db.prepare('SELECT * FROM users WHERE email=?').get(q.body.email);
 if(!u||!bcrypt.compareSync(q.body.password||'',u.password))return s.status(401).json({error:'Wrong email or password'});
 s.json({token:jwt.sign({id:u.id,company:u.company},SECRET,{expiresIn:'8h'}),company:u.company})}));
app.post('/api/register',wrap((q,s)=>{const{email,password,company}=q.body;if(!email||!password||password.length<6)throw Error('Email and a 6+ character password are required');
 db.prepare('INSERT INTO users(email,password,company) VALUES(?,?,?)').run(email,bcrypt.hashSync(password,10),company||email);s.json({ok:true})}));
app.get('/api/certificates/:n',wrap((q,s)=>{const c=db.prepare('SELECT * FROM certificates WHERE number=?').get(q.params.n);c?s.json(c):s.status(404).json({error:'Certificate not found'})}));
app.use('/api',auth);
app.get('/api/stats',wrap((q,s)=>{const id=q.user.id,one=(sql)=>db.prepare(sql).get(id);
 s.json({sales:one("SELECT COALESCE(SUM(amount),0) v FROM orders WHERE user_id=? AND status!='Cancelled'").v,orders:one('SELECT COUNT(*) v FROM orders WHERE user_id=?').v,
 items:one('SELECT COALESCE(SUM(stock),0) v FROM gemstones WHERE user_id=?').v,customers:one('SELECT COUNT(DISTINCT customer) v FROM orders WHERE user_id=?').v,
 top:db.prepare("SELECT g.name,COUNT(*) sold,SUM(o.amount) revenue FROM orders o JOIN gemstones g ON g.id=o.gemstone_id WHERE o.user_id=? GROUP BY g.id ORDER BY revenue DESC LIMIT 4").all(id),
 daily:db.prepare("SELECT date(created_at) d,SUM(amount) v FROM orders WHERE user_id=? GROUP BY d ORDER BY d").all(id)})}));
app.get('/api/market',wrap((q,s)=>{const c=q.query.category;s.json(db.prepare(`SELECT g.*,u.company seller FROM gemstones g JOIN users u ON u.id=g.user_id WHERE g.status='published' AND g.stock>0 ${c&&c!=='All'?'AND g.category=?':''}`).all(...(c&&c!=='All'?[c]:[])))}));
app.get('/api/gemstones',wrap((q,s)=>s.json(db.prepare('SELECT * FROM gemstones WHERE user_id=? ORDER BY id DESC').all(q.user.id))));
const F=['name','category','carat','shape','color','origin','treatment','price','stock','certificate_no','status'];
app.post('/api/gemstones',wrap((q,s)=>{if(!q.body.name||!(q.body.price>0))throw Error('Name and a price above 0 are required');
 const r=db.prepare(`INSERT INTO gemstones(user_id,${F}) VALUES(?,${F.map(()=>'?')})`).run(q.user.id,...F.map(k=>q.body[k]??(k=='status'?'published':null)));s.json({id:r.lastInsertRowid})}));
app.put('/api/gemstones/:id',wrap((q,s)=>{db.prepare(`UPDATE gemstones SET ${F.map(k=>k+'=?')} WHERE id=? AND user_id=?`).run(...F.map(k=>q.body[k]),q.params.id,q.user.id);s.json({ok:true})}));
app.delete('/api/gemstones/:id',wrap((q,s)=>{db.prepare('DELETE FROM gemstones WHERE id=? AND user_id=?').run(q.params.id,q.user.id);s.json({ok:true})}));
app.get('/api/orders',wrap((q,s)=>s.json(db.prepare('SELECT o.*,g.name gem FROM orders o LEFT JOIN gemstones g ON g.id=o.gemstone_id WHERE o.user_id=? ORDER BY o.id DESC').all(q.user.id))));
app.post('/api/orders',wrap((q,s)=>{const g=db.prepare('SELECT * FROM gemstones WHERE id=?').get(q.body.gemstone_id);if(!g||g.stock<1)throw Error('Out of stock');
 db.transaction(()=>{db.prepare('UPDATE gemstones SET stock=stock-1 WHERE id=?').run(g.id);
 db.prepare('INSERT INTO orders(user_id,customer,gemstone_id,amount) VALUES(?,?,?,?)').run(g.user_id,q.body.customer||q.user.company,g.id,g.price)})();s.json({ok:true})}));
app.put('/api/orders/:id',wrap((q,s)=>{db.prepare('UPDATE orders SET status=? WHERE id=? AND user_id=?').run(q.body.status,q.params.id,q.user.id);s.json({ok:true})}));
app.listen(3000,()=>console.log('Running on http://localhost:3000'));
