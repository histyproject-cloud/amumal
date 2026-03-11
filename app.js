const SUPABASE_URL='https://oathqvxogecbrpswnjxk.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdGhxdnhvZ2VjYnJwc3duanhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTA5NDYsImV4cCI6MjA4ODYyNjk0Nn0.zrieOYKfxDB4r_czc8dz-bA33Yr_LR7BdWqWA_SZQb8';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

const POST_COOLDOWN=30000;
const REPORT_THRESHOLD=5;
const MAX_IMAGES=3;
const BANNED_WORDS=['시발','씨발','개새끼','병신','ㅅㅂ','ㅄ','ㅂㅅ','지랄','fuck','shit'];

const AMUMALS=[
  {title:'요즘 가장 많이 드는 생각이 뭐예요?', sub:'솔직하게 털어놔요'},
  {title:'인생에서 후회하는 선택 하나만 꼽는다면?', sub:'바꿀 수 있다면 뭘 바꿀건지'},
  {title:'지금 이 순간 가장 먹고 싶은 게 뭐예요?', sub:'야식 고민 중이라면 같이 얘기해요'},
  {title:'최근에 갑자기 보고 싶어진 사람 있어요?', sub:'연락은 했나요?'},
  {title:'요즘 잠을 잘 자고 있나요?', sub:'수면 루틴 공유해봐요'},
  {title:'살면서 가장 웃겼던 순간은?', sub:'그냥 생각나서 혼자 웃은 적 있잖아요'},
  {title:'지금 당장 여행 가고 싶다면 어디?', sub:'이유도 알려줘요'},
  {title:'나만 아는 꿀팁 하나 공유해봐요', sub:'생활, 공부, 뭐든 ok'},
  {title:'요즘 나를 힘들게 하는 게 뭔지 털어놔요', sub:'판단 없이 들을게요'},
  {title:'오늘 하루 어땠어요?', sub:'잘된 것도 안된 것도 다 얘기해요'},
];

let currentPostId=null, currentPostData=null, currentTab='recent';
let lastPostTime=0, selectedImages=[], reportTarget={type:null,id:null};
let postCooldownTimer=null, latestPostId=null, newPostCount=0;
let searchQuery='', searchTimer=null;
let pollActive=false;
let userVotes={}; // {postId: optionIndex}
let commentImages=[]; // 댓글 이미지
let replyImages={}; // {parentId: [images]}
let myIp=''; // 사용자 IP
let unreadOnly=false; // 안 본 글만 보기
let readPostIds=new Set(); // 읽은 글 ID 목록

window.onload=async()=>{
  showSkeleton();
  loadNotices();
  loadAmumal();
  loadBannedWordsFromDB();
  // IP 가져오기 (글 로드 전에 완료)
  try{
    const r=await fetch('https://api.ipify.org?format=json');
    const d=await r.json();
    myIp=d.ip||'';
  }catch(e){
    try{
      const r=await fetch('https://api64.ipify.org?format=json');
      const d=await r.json();
      myIp=d.ip||'';
    }catch{}
  }
  // 차단 여부 체크 (IP 확보 후)
  if(myIp){
    try{
      const{data:banned}=await sb.from('banned_ips').select('ip').eq('ip',myIp).maybeSingle();
      if(banned){
        document.getElementById('writeBox').innerHTML=`<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">⛔ 이용이 제한된 사용자입니다.</div>`;
      }
    }catch{}
  }
  await loadPosts();
  startAutoRefresh();
  try { userVotes=JSON.parse(localStorage.getItem('amuVotes')||'{}'); } catch{}
  try { readPostIds=new Set(JSON.parse(localStorage.getItem('amuRead')||'[]')); } catch{}
};


// ── 오늘의 아무말 ──
function loadAmumal(){
  const idx=new Date().getDate()%AMUMALS.length;
  const h=AMUMALS[idx];
  document.getElementById('hotissueTitle').textContent=h.title;
  document.getElementById('hotissueSub').textContent=h.sub;
  document.getElementById('hotissueBanner').style.display='block';
}
function openHotissue(){
  const idx=new Date().getDate()%AMUMALS.length;
  const h=AMUMALS[idx];
  document.getElementById('searchInput').value=h.title.split(' ')[0];
  doSearch();
}

// ── 공지사항 ──
let dbBannedWords=[];

async function loadNotices(){
  try{
    const{data}=await sb.from('notices').select('*').eq('active',true).order('created_at',{ascending:false});
    const list=data||[];
    const el=document.getElementById('noticeList');
    if(!list.length){el.innerHTML='';return;}
    el.innerHTML=`<div class="notice-list">${list.map(n=>`
      <div class="notice-item" onclick="openPost(${n.post_id||0})">
        <span class="notice-badge">📢 공지</span>
        <span class="notice-text">${escHtml(n.content)}</span>
        <span class="notice-time">${timeAgo(n.created_at)}</span>
      </div>`).join('')}</div>`;
  }catch{}
}

// ── 금칙어 DB ──
async function loadBannedWordsFromDB(){
  try{
    const{data}=await sb.from('banned_words').select('word');
    dbBannedWords=(data||[]).map(r=>r.word);
  }catch{}
}

// ── 검색 ──
function onSearchInput(el){
  const val=el.value.trim();
  document.getElementById('searchClear').classList.toggle('show',val.length>0);
  clearTimeout(searchTimer);
  if(!val){clearSearch();return;}
  searchTimer=setTimeout(()=>doSearch(),400);
}
async function doSearch(){
  const val=document.getElementById('searchInput').value.trim();
  if(!val){clearSearch();return;}
  searchQuery=val;
  document.getElementById('writeBox').style.display='none';
  document.getElementById('hotissueBanner').style.display='none';
  document.getElementById('tabsBar').style.display='none';
  document.getElementById('newPostsBtn').style.display='none';
  document.getElementById('searchBanner').classList.add('show');
  showSkeleton();
  try{
    const{data,error}=await sb.from('posts').select('*').ilike('content',`%${val}%`).order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    document.getElementById('searchBannerText').innerHTML=`<strong>"${escHtml(val)}"</strong> 검색 결과 ${(data||[]).length}개`;
    renderList(data||[],val);
  }catch(e){
    document.getElementById('postList').innerHTML=`<div class="empty-state"><div>⚠️</div><p>검색 오류</p></div>`;
  }
}
function clearSearch(){
  searchQuery='';
  document.getElementById('searchInput').value='';
  document.getElementById('searchClear').classList.remove('show');
  document.getElementById('searchBanner').classList.remove('show');
  document.getElementById('writeBox').style.display='block';
  document.getElementById('hotissueBanner').style.display='block';
  document.getElementById('tabsBar').style.display='flex';
  showSkeleton();
  loadPosts();
}

// ── 글 목록 ──
function showSkeleton(){
  document.getElementById('postList').innerHTML=[1,2,3].map(()=>`
    <div class="skeleton">
      <div class="skel-line" style="width:60px;margin-bottom:12px"></div>
      <div class="skel-line" style="width:90%"></div>
      <div class="skel-line" style="width:70%"></div>
      <div class="skel-line" style="width:80px;margin-top:12px"></div>
    </div>`).join('');
}

async function loadPosts(){
  try{
    let query=sb.from('posts').select('*');
    if(currentTab==='recent'){
      query=query.order('created_at',{ascending:false}).limit(50);
    }else if(currentTab==='hot'){
      const since=new Date(Date.now()-86400000).toISOString();
      query=query.gte('created_at',since).limit(100);
    }else if(currentTab==='comments'){
      // comment_count 컬럼 없을 수 있어서 created_at으로 fallback
      try{
        query=query.order('comment_count',{ascending:false}).limit(50);
      }catch{
        query=sb.from('posts').select('*').order('created_at',{ascending:false}).limit(50);
      }
    }else if(currentTab==='debate'){
      query=query.limit(200);
    }
    const{data,error}=await query;
    if(error)throw error;
    let result=data||[];

    if(currentTab==='hot'){
      result=result.sort((a,b)=>(b.up||0)+(b.comment_count||0)*2-((a.up||0)+(a.comment_count||0)*2)).slice(0,50);
    }else if(currentTab==='debate'){
      // 논쟁지수: 댓글 10개+, up+down 20+, 비율 30~70%
      result=result.filter(p=>{
        const total=(p.up||0)+(p.down||0);
        if(total<20)return false;
        const ratio=(p.up||0)/total;
        return ratio>=0.3&&ratio<=0.7;
      }).sort((a,b)=>{
        const sa=(a.comment_count||0)+(a.up||0)+(a.down||0);
        const sb2=(b.comment_count||0)+(b.up||0)+(b.down||0);
        return sb2-sa;
      }).slice(0,50);
    }

    renderList(result);
    if(result.length>0&&currentTab==='recent') latestPostId=result[0].id;
  }catch(e){
    document.getElementById('postList').innerHTML=`<div class="empty-state"><div>⚠️</div><p>글을 불러오지 못했어요<br><small>${e.message}</small></p></div>`;
  }
}

function renderList(posts,highlight=''){
  const c=document.getElementById('postList');
  // 안 본 글 필터
  const filtered=unreadOnly?posts.filter(p=>!readPostIds.has(p.id)):posts;
  if(!filtered.length){
    c.innerHTML=unreadOnly
      ?`<div class="empty-state"><div>✅</div><p>안 본 글이 없어요</p></div>`
      :(highlight
        ?`<div class="empty-state"><div>🔍</div><p>"${escHtml(highlight)}" 결과 없음</p></div>`
        :(currentTab==='debate'
          ?`<div class="empty-state"><div>⚔️</div><p>아직 논쟁글이 없어요<br><small>공감+비공감 합 20 이상, 비율 30~70% 조건</small></p></div>`
          :`<div class="empty-state"><div>🌑</div><p>아직 글이 없어요</p></div>`));
    return;
  }
  const adSlot=()=>`<div class="ad-slot" style="margin:6px 0 10px"><div class="ad-slot-label">ADVERTISEMENT</div><span>광고 영역 (320×100)</span></div>`;
  const cards=filtered.map(p=>renderPostCard(p,highlight));
  const withAds=[];
  cards.forEach((card,i)=>{
    withAds.push(card);
    if((i+1)%3===0&&i+1<cards.length)withAds.push(adSlot());
  });
  c.innerHTML=withAds.join('');
}

function renderPostCard(p,highlight=''){
  if(p.hidden&&p.report_count>=REPORT_THRESHOLD){
    return`<div class="hidden-post">신고 누적으로 숨겨진 글 <span onclick="revealPost(${p.id})">보기</span></div>`;
  }
  const raw=(p.content||'');
  const preview=raw.length>120?raw.slice(0,120)+'...':raw;
  const displayContent=highlight?highlightText(escHtml(preview),highlight):escHtml(preview);
  const images=p.images||[];
  const thumbs=images.slice(0,3).map(src=>`<img src="${src}" alt="" onclick="event.stopPropagation();openLightbox('${src}')">`).join('');
  const poll=p.poll;
  let pollHtml='';
  if(poll&&poll.question){
    const votes=p.poll_votes||[];
    const total=votes.length;
    const opts=poll.options||[];
    pollHtml=`<div class="poll-preview">
      <div class="poll-preview-q">⚡ ${escHtml(poll.question)}</div>
      ${opts.map((opt,i)=>{
        const cnt=votes.filter(v=>v===i).length;
        const pct=total>0?Math.round(cnt/total*100):0;
        return`<div class="poll-bar-wrap">
          <div class="poll-bar-label"><span>${escHtml(opt)}</span><span>${pct}%</span></div>
          <div class="poll-bar-track"><div class="poll-bar-fill opt${i}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
      <div class="poll-total">${total}명 참여</div>
    </div>`;
  }
  const tag=poll?'투표':(p.tag||'잡담');
  return`
    <div class="post-card" onclick="openPost(${p.id})">
      <div class="post-card-header">
        <span class="tag-badge tag-${tag}">${p.tag||'잡담'}${poll?' ⚡':''}</span>
        <span class="post-time">${timeAgo(p.created_at)}</span>
      </div>
      ${p.title?`<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;line-height:1.4">${escHtml(p.title)}</div>`:''}
      ${displayContent?`<div class="post-content">${displayContent}</div>`:''}
      ${pollHtml}
      ${thumbs?`<div class="post-thumb">${thumbs}</div>`:''}
      <div class="post-footer">
        <span class="stat-item">👍 ${p.up||0}</span>
        <span class="stat-item">👎 ${p.down||0}</span>
        <span class="stat-item">💬 ${p.comment_count||0}</span>
        ${images.length?'<span class="stat-item">🖼</span>':''}
      </div>
    </div>`;
}

function highlightText(html,query){
  if(!query)return html;
  const esc=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return html.replace(new RegExp(`(${esc})`,'gi'),'<span class="highlight">$1</span>');
}

// ── VS 투표 작성 ──
function togglePoll(){
  pollActive=!pollActive;
  document.getElementById('pollWrite').style.display=pollActive?'block':'none';
  document.getElementById('pollToggleBtn').classList.toggle('active',pollActive);
}
function addPollOption(){
  const list=document.getElementById('pollOptionsList');
  if(list.children.length>=4){showToast('최대 4개까지 가능해요');return;}
  const row=document.createElement('div');
  row.className='poll-option-row';
  row.innerHTML=`<input class="poll-option-input" placeholder="선택지 ${list.children.length+1}" maxlength="30"><button class="poll-option-del" onclick="removePollOption(this)">✕</button>`;
  list.appendChild(row);
  updateDelBtns();
  if(list.children.length>=4)document.getElementById('pollAddBtn').style.display='none';
}
function removePollOption(btn){
  btn.parentElement.remove();
  document.getElementById('pollAddBtn').style.display='block';
  updateDelBtns();
}
function updateDelBtns(){
  const rows=document.querySelectorAll('.poll-option-row');
  rows.forEach((r,i)=>{r.querySelector('.poll-option-del').style.display=rows.length>2?'block':'none';});
}

// ── 글 작성 ──
function onWriteInput(el){document.getElementById('charCount').textContent=`${el.value.length}/500`;}

function handleImageSelect(input){
  const files=Array.from(input.files);
  const remaining=MAX_IMAGES-selectedImages.length;
  if(files.length>remaining)showToast(`최대 ${MAX_IMAGES}장`);
  files.slice(0,remaining).forEach(file=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      const max=800;let w=img.width,h=img.height;
      if(w>max){h=h*(max/w);w=max;}if(h>max){w=w*(max/h);h=max;}
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      selectedImages.push(canvas.toDataURL('image/jpeg',0.75));
      renderPreview();URL.revokeObjectURL(url);
    };
    img.src=url;
  });
  input.value='';
}
function renderPreview(){
  document.getElementById('previewImages').innerHTML=selectedImages.map((src,i)=>
    `<div class="preview-img"><img src="${src}" alt=""><button class="remove-img" onclick="removeImage(${i})">✕</button></div>`).join('');
}
function removeImage(i){selectedImages.splice(i,1);renderPreview();}

async function submitPost(){
  const content=document.getElementById('writeContent').value.trim();
  if(!content&&!pollActive){showToast('내용을 입력해주세요');return;}
  if(content&&hasBannedWord(content)){showToast('사용할 수 없는 단어 포함');return;}
  const now=Date.now();
  if(now-lastPostTime<POST_COOLDOWN){
    showToast(`${Math.ceil((POST_COOLDOWN-(now-lastPostTime))/1000)}초 후 가능`);return;
  }
  // IP 차단 체크
  if(myIp){
    const{data:banned}=await sb.from('banned_ips').select('ip').eq('ip',myIp).maybeSingle();
    if(banned){showToast('⛔ 이용이 제한된 사용자입니다.');return;}
  }

  // 투표 유효성
  let pollData=null;
  if(pollActive){
    const q=document.getElementById('pollQuestion').value.trim();
    const opts=Array.from(document.querySelectorAll('.poll-option-input')).map(i=>i.value.trim()).filter(Boolean);
    if(!q){showToast('투표 질문을 입력해주세요');return;}
    if(opts.length<2){showToast('선택지를 2개 이상 입력해주세요');return;}
    pollData={question:q,options:opts};
  }

  const btn=document.getElementById('submitBtn');
  btn.disabled=true;btn.textContent='올리는 중...';
  try{
    const tag=document.getElementById('writeTag').value;
    const title=document.getElementById('writeTitle').value.trim();
    const{error}=await sb.from('posts').insert({
      tag,title:title||null,content,images:selectedImages,up:0,down:0,report_count:0,hidden:false,
      poll:pollData,poll_votes:[],ip:myIp
    });
    if(error)throw error;
    document.getElementById('writeContent').value='';
    document.getElementById('writeTitle').value='';
    document.getElementById('charCount').textContent='0/500';
    selectedImages=[];renderPreview();
    if(pollActive){
      togglePoll();
      document.getElementById('pollQuestion').value='';
      document.querySelectorAll('.poll-option-input').forEach((el,i)=>{el.value='';});
    }
    lastPostTime=now;startCooldown();
    await loadPosts();
    showToast('글이 등록됐어요! 🎉');
  }catch(e){
    showToast('오류: '+e.message);
    btn.disabled=false;btn.textContent='올리기';
  }
}

function hasBannedWord(t){
  return BANNED_WORDS.some(w=>t.includes(w))||dbBannedWords.some(w=>t.includes(w));
}

function startCooldown(){
  const btn=document.getElementById('submitBtn');
  btn.textContent='올리기';btn.disabled=true;
  let remaining=POST_COOLDOWN/1000;
  if(postCooldownTimer)clearInterval(postCooldownTimer);
  postCooldownTimer=setInterval(()=>{
    remaining--;
    btn.textContent=`${remaining}초 후 가능`;
    if(remaining<=0){clearInterval(postCooldownTimer);btn.disabled=false;btn.textContent='올리기';}
  },1000);
}

async function switchTab(tab,el){
  if(searchQuery)return;
  currentTab=tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');showSkeleton();await loadPosts();
}

function toggleUnread(){
  unreadOnly=!unreadOnly;
  const btn=document.getElementById('unreadToggle');
  btn.classList.toggle('on',unreadOnly);
  btn.textContent=unreadOnly?'👁 안 본 글만 ✓':'👁 안 본 글만';
  showSkeleton();loadPosts();
}

// ── 상세 ──
async function openPost(id){
  currentPostId=id;
  // 읽음 처리
  readPostIds.add(id);
  try{localStorage.setItem('amuRead',JSON.stringify([...readPostIds]));}catch{}
  document.getElementById('dContent').textContent='불러오는 중...';
  document.getElementById('commentList').innerHTML='';
  document.getElementById('dPoll').style.display='none';
  document.getElementById('sharePanel').classList.remove('open');
  document.getElementById('detailOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  document.querySelector('.detail-panel').scrollTop=0;

  // 공유 링크 설정 (현재는 파일 경로, 배포 후엔 실제 URL)
  const shareUrl=`${location.href.split('?')[0]}?post=${id}`;
  document.getElementById('shareLink').textContent=shareUrl;
  document.getElementById('shareLink').dataset.url=shareUrl;

  try{
    const{data:post,error}=await sb.from('posts').select('*').eq('id',id).single();
    if(error)throw error;
    currentPostData=post;
    document.getElementById('dTag').textContent=post.tag;
    document.getElementById('dTag').className=`tag-badge tag-${post.tag}`;
    document.getElementById('dTime').textContent=timeAgo(post.created_at);
    document.getElementById('dContent').textContent=post.content||'';
    if(post.title){
      document.getElementById('dContent').innerHTML=`<div style="font-size:18px;font-weight:700;margin-bottom:12px;line-height:1.4;color:var(--text)">${escHtml(post.title)}</div>${escHtml(post.content||'').replace(/\n/g,'<br>')}`;
    }
    document.getElementById('upCount').textContent=post.up||0;
    document.getElementById('downCount').textContent=post.down||0;
    document.getElementById('upBtn').className='react-btn up';
    document.getElementById('downBtn').className='react-btn down';
    document.getElementById('dImages').innerHTML=(post.images||[]).map(src=>
      `<img src="${src}" alt="" onclick="openLightbox('${src}')">`).join('');

    // 투표 렌더
    if(post.poll&&post.poll.question){
      renderPollDetail(post);
    }
    await loadComments(id);
  }catch(e){document.getElementById('dContent').textContent='글을 불러오지 못했어요';}
}

function renderPollDetail(post){
  const poll=post.poll;
  const votes=post.poll_votes||[];
  const total=votes.length;
  const myVote=userVotes[post.id];
  const hasVoted=myVote!==undefined;

  document.getElementById('dPollQ').textContent=poll.question;
  document.getElementById('dPollTotal').textContent=`총 ${total}명 참여`;
  document.getElementById('dPollOptions').innerHTML=poll.options.map((opt,i)=>{
    const cnt=votes.filter(v=>v===i).length;
    const pct=total>0?Math.round(cnt/total*100):0;
    const isVoted=myVote===i;
    return`<button class="poll-option-btn opt${i}${isVoted?' voted':''}" onclick="vote(${i})">
      <div class="poll-fill" style="width:${hasVoted?pct:0}%"></div>
      <div class="poll-option-inner">
        <span>${escHtml(opt)}</span>
        ${hasVoted?`<span class="poll-pct">${pct}%</span>`:''}
      </div>
    </button>`;
  }).join('');
  document.getElementById('dPoll').style.display='block';
}

async function vote(optionIndex){
  if(!currentPostData||!currentPostData.poll)return;
  if(userVotes[currentPostId]!==undefined){showToast('이미 투표했어요');return;}
  const votes=[...(currentPostData.poll_votes||[]),optionIndex];
  const{error}=await sb.from('posts').update({poll_votes:votes}).eq('id',currentPostId);
  if(error){showToast('투표 오류');return;}
  userVotes[currentPostId]=optionIndex;
  try{localStorage.setItem('amuVotes',JSON.stringify(userVotes));}catch{}
  currentPostData.poll_votes=votes;
  renderPollDetail(currentPostData);
  showToast('투표했어요! ✅');
}

function handleOverlayClick(e){if(e.target===document.getElementById('detailOverlay'))closeDetail();}
function closeDetail(){
  document.getElementById('detailOverlay').classList.remove('open');
  document.body.style.overflow='';
  currentPostId=null;currentPostData=null;
}

// ── 공유 ──
function toggleShare(){
  document.getElementById('sharePanel').classList.toggle('open');
}
function shareKakao(){
  const url=document.getElementById('shareLink').dataset.url||location.href;
  // Kakao SDK 없이 카카오링크 앱스킴 사용 (모바일)
  const text=`아무말 익명커뮤니티에서 글을 공유했어요: ${url}`;
  if(navigator.share){
    navigator.share({title:'아무말',text,url}).catch(()=>{});
  }else{
    window.open(`https://story.kakao.com/share?url=${encodeURIComponent(url)}`,'_blank');
  }
}
function shareX(){
  const url=document.getElementById('shareLink').dataset.url||location.href;
  window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent('아무말 익명 커뮤니티')}`, '_blank');
}
function copyLink(){
  const url=document.getElementById('shareLink').dataset.url||location.href;
  navigator.clipboard.writeText(url).then(()=>showToast('링크 복사됐어요!')).catch(()=>{
    document.getElementById('shareLink').select&&document.getElementById('shareLink').select();
    showToast('링크를 직접 복사해주세요');
  });
}

// ── 댓글 ──
async function loadComments(postId){
  const{data,error}=await sb.from('comments').select('*').eq('post_id',postId).order('created_at',{ascending:true});
  if(error)return;
  const all=data||[];
  const top=all.filter(c=>!c.parent_id);
  const replies=all.filter(c=>c.parent_id);
  document.getElementById('commentsTitle').textContent=`댓글 ${all.length}개`;
  if(!top.length){
    document.getElementById('commentList').innerHTML=`<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">첫 댓글을 남겨보세요</div>`;
    return;
  }
  document.getElementById('commentList').innerHTML=top.map(c=>renderComment(c,replies.filter(r=>r.parent_id===c.id))).join('');
}

function renderComment(c,replies=[]){
  const repliesHtml=replies.map(r=>`
    <div class="comment-item reply">
      <div class="comment-header">
        <span style="font-size:10px;color:var(--blue)">↳</span>
        <span class="comment-anon">익명</span>
        <span class="comment-time">${timeAgo(r.created_at)}</span>
      </div>
      <div class="comment-text">${escHtml(r.content)}</div>
      ${(r.images&&r.images.length)?`<div class="comment-img-wrap">${r.images.map(src=>`<img src="${src}" alt="" onclick="openLightbox('${src}')" style="margin-right:6px;margin-bottom:4px;">`).join('')}</div>`:''}
      <div class="comment-actions">
        <button class="comment-like-btn" onclick="likeComment(${r.id},this)">👍 ${r.up||0}</button>
        <button class="comment-report-btn" onclick="openReport('comment',${r.id})">신고</button>
      </div>
    </div>`).join('');
  return`
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-anon">익명</span>
        <span class="comment-time">${timeAgo(c.created_at)}</span>
      </div>
      <div class="comment-text">${escHtml(c.content)}</div>
      ${(c.images&&c.images.length)?`<div class="comment-img-wrap">${c.images.map(src=>`<img src="${src}" alt="" onclick="openLightbox('${src}')" style="margin-right:6px;margin-bottom:4px;">`).join('')}</div>`:''}
      <div class="comment-actions">
        <button class="comment-like-btn" onclick="likeComment(${c.id},this)">👍 ${c.up||0}</button>
        <button class="reply-toggle-btn" onclick="toggleReply(${c.id})">↩ 답글</button>
        <button class="comment-report-btn" onclick="openReport('comment',${c.id})">신고</button>
      </div>
      <div class="reply-write" id="replyWrite-${c.id}">
        <div class="reply-write-inner">
          <label class="comment-img-label" for="replyImgInput-${c.id}">📷</label>
          <input type="file" id="replyImgInput-${c.id}" accept="image/*" multiple style="display:none" onchange="handleReplyImageSelect(this,${c.id})">
          <input class="reply-input" id="replyInput-${c.id}" placeholder="답글 입력..." maxlength="200">
          <button class="reply-submit" onclick="submitReply(${c.id})">등록</button>
        </div>
        <div class="comment-img-preview" id="replyImgPreview-${c.id}"></div>
      </div>
    </div>${repliesHtml}`;
}

function toggleReply(cid){
  const el=document.getElementById(`replyWrite-${cid}`);
  el.classList.toggle('open');
  if(el.classList.contains('open'))document.getElementById(`replyInput-${cid}`).focus();
}

// ── 반응 ──
async function react(type){
  if(!currentPostId||!currentPostData)return;
  const upBtn=document.getElementById('upBtn'),downBtn=document.getElementById('downBtn');
  const upActive=upBtn.classList.contains('active'),downActive=downBtn.classList.contains('active');
  let newUp=currentPostData.up||0,newDown=currentPostData.down||0;
  if(type==='up'){
    if(upActive){upBtn.classList.remove('active');newUp=Math.max(0,newUp-1);}
    else{upBtn.classList.add('active');newUp++;if(downActive){downBtn.classList.remove('active');newDown=Math.max(0,newDown-1);}}
  }else{
    if(downActive){downBtn.classList.remove('active');newDown=Math.max(0,newDown-1);}
    else{downBtn.classList.add('active');newDown++;if(upActive){upBtn.classList.remove('active');newUp=Math.max(0,newUp-1);}}
  }
  document.getElementById('upCount').textContent=newUp;
  document.getElementById('downCount').textContent=newDown;
  currentPostData.up=newUp;currentPostData.down=newDown;
  await sb.from('posts').update({up:newUp,down:newDown}).eq('id',currentPostId);
  if(!searchQuery)loadPosts();
}

async function likeComment(id,btn){
  const cur=parseInt(btn.textContent.replace('👍','').trim())||0;
  const active=btn.classList.contains('active');
  const newVal=Math.max(0,active?cur-1:cur+1);
  btn.classList.toggle('active');btn.textContent=`👍 ${newVal}`;
  await sb.from('comments').update({up:newVal}).eq('id',id);
}

// ── 댓글 작성 ──
async function submitComment(){
  const input=document.getElementById('commentInput');
  const text=input.value.trim();
  if(!text&&!commentImages.length||!currentPostId)return;
  if(text&&hasBannedWord(text)){showToast('사용할 수 없는 단어 포함');return;}
  if(myIp){
    const{data:banned}=await sb.from('banned_ips').select('ip').eq('ip',myIp).maybeSingle();
    if(banned){showToast('⛔ 이용이 제한된 사용자입니다.');return;}
  }
  try{
    await sb.from('comments').insert({post_id:currentPostId,content:text,up:0,images:commentImages,ip:myIp});
    try{
      const newCount=(currentPostData?.comment_count||0)+1;
      await sb.from('posts').update({comment_count:newCount}).eq('id',currentPostId);
      if(currentPostData)currentPostData.comment_count=newCount;
    }catch{}
    input.value='';input.style.height='40px';
    commentImages=[];renderCommentImgPreview();
    await loadComments(currentPostId);
    showToast('댓글 등록됐어요');
    setTimeout(()=>{document.querySelector('.detail-panel').scrollTop=99999;},100);
  }catch(e){showToast('오류: '+e.message);}
}

async function submitReply(parentId){
  const input=document.getElementById(`replyInput-${parentId}`);
  const text=input.value.trim();
  const imgs=replyImages[parentId]||[];
  if(!text&&!imgs.length||!currentPostId)return;
  if(text&&hasBannedWord(text)){showToast('사용할 수 없는 단어 포함');return;}
  if(myIp){
    const{data:banned}=await sb.from('banned_ips').select('ip').eq('ip',myIp).maybeSingle();
    if(banned){showToast('⛔ 이용이 제한된 사용자입니다.');return;}
  }
  try{
    await sb.from('comments').insert({post_id:currentPostId,parent_id:parentId,content:text,up:0,images:imgs,ip:myIp});
    try{
      const newCount=(currentPostData?.comment_count||0)+1;
      await sb.from('posts').update({comment_count:newCount}).eq('id',currentPostId);
      if(currentPostData)currentPostData.comment_count=newCount;
    }catch{}
    input.value='';
    replyImages[parentId]=[];
    document.getElementById(`replyWrite-${parentId}`).classList.remove('open');
    await loadComments(currentPostId);
    showToast('답글 등록됐어요');
  }catch(e){showToast('오류: '+e.message);}
}
function compressImage(file,callback){
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{
    const canvas=document.createElement('canvas');
    const max=600;let w=img.width,h=img.height;
    if(w>max){h=h*(max/w);w=max;}if(h>max){w=w*(max/h);h=max;}
    canvas.width=w;canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0,w,h);
    callback(canvas.toDataURL('image/jpeg',0.7));
    URL.revokeObjectURL(url);
  };img.src=url;
}

function handleCommentImageSelect(input){
  const files=Array.from(input.files);
  const remaining=2-commentImages.length;
  if(!remaining){showToast('댓글 이미지는 최대 2장');return;}
  files.slice(0,remaining).forEach(f=>compressImage(f,data=>{
    commentImages.push(data);renderCommentImgPreview();
  }));
  input.value='';
}

function renderCommentImgPreview(){
  document.getElementById('commentImgPreview').innerHTML=commentImages.map((src,i)=>
    `<div class="comment-img-preview-item"><img src="${src}"><button onclick="removeCommentImg(${i})">✕</button></div>`).join('');
}
function removeCommentImg(i){commentImages.splice(i,1);renderCommentImgPreview();}

function handleReplyImageSelect(input,parentId){
  const files=Array.from(input.files);
  if(!replyImages[parentId])replyImages[parentId]=[];
  const remaining=2-replyImages[parentId].length;
  if(!remaining){showToast('답글 이미지는 최대 2장');return;}
  files.slice(0,remaining).forEach(f=>compressImage(f,data=>{
    replyImages[parentId].push(data);renderReplyImgPreview(parentId);
  }));
  input.value='';
}

function renderReplyImgPreview(parentId){
  const el=document.getElementById(`replyImgPreview-${parentId}`);
  if(!el)return;
  el.innerHTML=(replyImages[parentId]||[]).map((src,i)=>
    `<div class="comment-img-preview-item"><img src="${src}"><button onclick="removeReplyImg(${parentId},${i})">✕</button></div>`).join('');
}
function removeReplyImg(parentId,i){replyImages[parentId].splice(i,1);renderReplyImgPreview(parentId);}

// ── 신고 ──
function openReport(type,id){reportTarget={type,id};document.getElementById('reportModal').classList.add('open');}
function closeReport(e){if(!e||e.target===document.getElementById('reportModal'))document.getElementById('reportModal').classList.remove('open');}

async function submitReport(reason){
  try{
    await sb.from('reports').insert({target_type:reportTarget.type,target_id:reportTarget.id||currentPostId,reason});
    if(reportTarget.type==='post'&&currentPostData){
      const newCount=(currentPostData.report_count||0)+1;
      const hidden=newCount>=REPORT_THRESHOLD;
      await sb.from('posts').update({report_count:newCount,hidden}).eq('id',currentPostId);
      if(hidden){closeDetail();showToast('신고 누적으로 숨겨졌어요');}
    }
    closeReport();showToast('신고 접수됐어요');
    if(!searchQuery)loadPosts();
  }catch(e){showToast('신고 오류');}
}

async function revealPost(id){
  await sb.from('posts').update({hidden:false}).eq('id',id);
  if(searchQuery)doSearch();else loadPosts();
}

// ── 자동 새로고침 ──
function startAutoRefresh(){
  setInterval(async()=>{
    if(currentTab!=='recent'||currentPostId||searchQuery)return;
    const{data}=await sb.from('posts').select('id').order('created_at',{ascending:false}).limit(1);
    if(data&&data[0]&&data[0].id!==latestPostId){
      newPostCount++;
      const btn=document.getElementById('newPostsBtn');
      btn.style.display='block';
      btn.textContent=`▲ 새 글 ${newPostCount}개 보기`;
    }
  },30000);
}

async function loadNewPosts(){
  newPostCount=0;
  document.getElementById('newPostsBtn').style.display='none';
  showSkeleton();await loadPosts();
}

// ── 유틸 ──
function openLightbox(src){document.getElementById('lightboxImg').src=src;document.getElementById('lightbox').classList.add('open');}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');}

let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function timeAgo(ts){
  const date=new Date(ts);
  const d=Date.now()-date.getTime();
  const pad=n=>String(n).padStart(2,'0');
  const dateStr=`${date.getMonth()+1}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if(d<60000)return`방금 (${dateStr})`;
  if(d<3600000)return`${Math.floor(d/60000)}분 전 (${dateStr})`;
  if(d<86400000)return`${Math.floor(d/3600000)}시간 전 (${dateStr})`;
  return dateStr;
}
function autoResize(el){el.style.height='40px';el.style.height=Math.min(el.scrollHeight,120)+'px';}

// ── 플로팅 버튼 ──
function scrollToTop(){
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(async()=>{
    showSkeleton();
    await loadPosts();
    showToast('새로고침 됐어요 ✨');
  },400);
}
function scrollToWrite(){
  // 상세 오버레이 열려있으면 닫기
  if(document.getElementById('detailOverlay').classList.contains('open')){
    closeDetail();
    setTimeout(()=>{
      window.scrollTo({top:0,behavior:'smooth'});
      setTimeout(()=>document.getElementById('writeContent').focus(),400);
    },100);
    return;
  }
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>document.getElementById('writeContent').focus(),400);
}

// 스크롤 내리면 ↑ 버튼 표시
window.addEventListener('scroll',()=>{
  const topBtn=document.getElementById('topBtn');
  if(window.scrollY>300)topBtn.classList.add('show');
  else topBtn.classList.remove('show');
});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeDetail();closeLightbox();closeReport();}
});

// ── 플로팅 버튼 ──
function scrollToTop(){
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(async()=>{
    showSkeleton();
    await loadPosts();
    showToast('새로고침됐어요 ✨');
  },400);
}
function scrollToWrite(){
  // 상세 오버레이 열려있으면 닫기
  if(document.getElementById('detailOverlay').classList.contains('open')){
    closeDetail();
    return;
  }
  const writeBox=document.getElementById('writeBox');
  writeBox.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>document.getElementById('writeContent').focus(),400);
}

// 스크롤에 따라 맨위로 버튼 표시
window.addEventListener('scroll',()=>{
  const topBtn=document.getElementById('topBtn');
  if(!topBtn)return;
  if(window.scrollY>300){topBtn.classList.add('show');}
  else{topBtn.classList.remove('show');}
});
