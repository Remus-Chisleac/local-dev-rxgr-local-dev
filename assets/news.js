// ---------------------------------------------------------------------------
// AICO storefront integration prelude.
//
// Ported from the production Shopify news theme. The data source is now the
// same-origin proxy (/blogs/news/feed.js, /blogs/news/categories.js) which
// authorizes via the shopper's storefront session cookie — so no client-side
// bearer token. The helper functions below (getParameterByName, formatDate,
// formatDateString, youtube_parser) were theme globals on Shopify; they are
// inlined here so this asset is self-contained.
// ---------------------------------------------------------------------------
function getParameterByName(name, url) {
  if (!url) { url = window.location.href; }
  name = name.replace(/[\[\]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
  var results = regex.exec(url);
  if (!results) { return null; }
  if (!results[2]) { return ''; }
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function youtube_parser(url) {
  var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  var match = (url || '').match(regExp);
  return (match && match[7] && match[7].length === 11) ? match[7] : '';
}

// Swiss-format date (DD.MM.YYYY); returns '' for empty/invalid input.
function formatDate(dateString) {
  if (!dateString) { return ''; }
  var date = new Date(dateString);
  if (isNaN(date.getTime())) { return ''; }
  var day = ('0' + date.getDate()).slice(-2);
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  return day + '.' + month + '.' + date.getFullYear();
}

// Same display format; the extra args are accepted for call-site
// compatibility with the original theme helper.
function formatDateString(dateString, format, withTime) {
  return formatDate(dateString);
}

var current_locale_code = $('html').attr('lang');
if(current_locale_code == 'de'){
  var current_locale_code = 'de_CH';
}
var Authorization = '';

// Storefront base prefix: '' on the host-based deployment
// ({slug}.shops.aico.swiss), '/__storefront-preview/{slug}' in the
// path-based preview. Derived from the current path so both the proxy
// fetch URLs and the generated links resolve correctly in either mode.
var STOREFRONT_PREFIX = (function () {
  var path = window.location.pathname;
  var index = path.indexOf('/blogs/news');
  return index > 0 ? path.slice(0, index) : '';
})();

var url = window.location.href,
    parts = url.split("/"),
    last_part = parts[parts.length-1];

var totalPage = '12';

if(last_part == ''){
    last_part = parts[parts.length-2];
}
var flag=0;

$(document).ready(function(){

  var has_inApp = getParameterByName('inApp');  
    
  var slidetoshow=7;
  
  if(getParameterByName('page') == null){
    var pageno = 1;
  }else{
    var pageno = getParameterByName('page')
  }
  if(getParameterByName('category') == null){
    var cat = '';
  }else{
    var cat = getParameterByName('category');
  }
  if(getParameterByName('player') == null){
    var plyr = '';
  }else{
    var plyr = getParameterByName('player');
  }
  
  if(getParameterByName('tags') != null){
    var tgs = getParameterByName('tags');
  }else{
    var tgs = '';
  }
  
  var is_listpage = true;
  
  if(last_part.indexOf('news?page') != -1){
    var q = "?page[number]="+pageno+"&page[size]="+totalPage+"&sort=-publishDate&filter[isActive]=1&filter[excludeTag][]=Eisnull";
  }
  else{
    if(last_part == 'news'){
      var q = "?page[number]="+pageno+"&page[size]="+totalPage+"&sort=-publishDate&filter[isActive]=1&filter[excludeTag][]=Eisnull";
    }else{
      if(getParameterByName('category') == null){
        if(plyr != ''){
          var q = "?page[number]="+pageno+"&page[size]="+totalPage+"&sort=-publishDate&filter[isActive]=1&filter[b2cId]="+plyr;
        }else if(tgs != ''){
          var tagValues = getParameterByName('tags');
          var tagValue = tagValues.split('+');
          var q = "?page[number]="+pageno+"&page[size]="+totalPage+"&sort=-publishDate&filter[isActive]=1";
          if(tagValue.length > 1){
            for(let t=0; t<tagValue.length; t++){
              q = q+"&filter[soccerTeam.title][]="+tagValue[t];
            }
          }else{
            q = q+"&filter[soccerTeam.title]="+tagValues;
          }
        }else{
          if(last_part.indexOf('?') != -1){
            last_part = last_part.split('?')[0];
          }
          var q = '/'+last_part;
          if(!$.isNumeric(last_part)){
            
            // Testing: filter[isPreview]=true returns unpublished/draft news
            var q = '?filter[urlHandle]='+last_part+'&filter[isPreview]=true';
          }
          //       var q = '/3';
          is_listpage = false;
          flag++;
          $('.news-list-wrapper').addClass('hidden');
        }
      }
      else{
        var q = "?page[number]="+pageno+"&page[size]="+totalPage+"&sort=-publishDate&filter[isActive]=1&filter[newsCategoryId]="+getParameterByName('category');
        if(getParameterByName('tags') != null){
          var tagValues = getParameterByName('tags');
          var tagValue = tagValues.split('+');
          if(tagValue.length > 1){
            for(let t=0; t<tagValue.length; t++){
              q = q+"&filter[soccerTeam.title][]="+tagValue[t];
            }
          }else{
            q = q+"&filter[soccerTeam.title]="+tagValues;
          }
        }
      }
    }
  }

  //console.log(q);
  
  var settings = {
    "url": STOREFRONT_PREFIX + "/blogs/news/feed.js"+q,
    "method": "GET",
    "timeout": 0,
    "headers": {
      "Authorization": Authorization,
      "Accept": "application/vnd.api+json",
    }
  };
  // Prefer the server-embedded article payload (article page) so the detail
  // renders with no network round-trip; fall back to the proxy fetch.
  var inlineArticleEl = document.getElementById('aico-article-data');
  var newsRequest;
  if (inlineArticleEl && !is_listpage) {
    var inlineResponse = null;
    try {
      var inlineAttrs = JSON.parse(inlineArticleEl.textContent);
      if (inlineAttrs && typeof inlineAttrs === 'object') {
        inlineResponse = { data: [ { attributes: inlineAttrs, id: inlineAttrs.id } ] };
      }
    } catch (e) { inlineResponse = null; }
    newsRequest = inlineResponse
      ? $.Deferred().resolve(inlineResponse).promise()
      : $.ajax(settings);
  } else {
    newsRequest = $.ajax(settings);
  }

  newsRequest.done(function (response) {
    //console.log(response);
    var totalData = response.data.length;
    var html = '';
        
    if(typeof totalData == 'undefined' || flag > 0){
    
    if(response.data.length == 0){
      $('#status').fadeOut();
      $('#preloader').fadeOut('slow');
      $('.page-wrapper').remove();
      $('#news-container').addClass('news-details-wrapper');
      $('body').addClass('news-details');
      $('#news-details-container').removeClass('hidden');
      html += '<h3>News not available</h3>';
      
    }
      if(typeof totalData == 'undefined'){
        var newsCat = response.data.attributes.newsCategory;
      }else{
        var newsCat = response.data[0].attributes.newsCategory;
      }
      
      var nq = '';
      if(newsCat != null){
        nq = '&filter[newsCategoryId]='+newsCat.translations[0].id;
      }
      
      
      var settings = {
        "url": STOREFRONT_PREFIX + "/blogs/news/feed.js?page[number]=1&page[size]=5&filter[isActive]=1&sort=-publishDate"+nq,
        "method": "GET",
        "timeout": 0,
        "headers": {
          "Authorization": Authorization,
          "Accept": "application/vnd.api+json"
        },
      };

      $.ajax(settings).done(function (responsen) {
        var totalNewsData = responsen.data.length;
        

        $('#status').fadeOut();
        $('#preloader').fadeOut('slow');
      
      /*destroyCarousel();
      setTimeout(function(){
        slickCarousel();
      },1000);*/
      
      
      $('.page-wrapper').remove();
      $('#news-container').addClass('news-details-wrapper');
      $('body').addClass('news-details');
      $('#news-details-container').removeClass('hidden');
        if(typeof totalData == 'undefined'){
          var data = response.data.attributes;
          var main_news_id = response.data.id;
        }else{
          var data = response.data[0].attributes;
          var main_news_id = response.data[0].id;
        }
        var main_urlHandle = data.urlHandle;
        
        var translations = data.translations;
        var news_title = data.name;
        
        if(translations.length>0){
          for(var t=0;t<translations.length;t++){
            var translation = translations[t];
            if(translation.locale == current_locale_code ){
              news_title = jQuery.trim(translation.name);
            }
          }
        }
        
        if(data.newsCategory != null){
          var cat = data.newsCategory.translations[0].name;
          if(cat == 'Frauen'){
            $('.section-frauen-partners').removeClass('hidden');
            $('.section-partners').addClass('hidden');
          }
        }
        
        var img = data.optimizedImage;
        if(data.optimizedImage == null){
          img = data.image;
        }else if(data.image == null){
          img = '';
        }

        var link = document.createElement('meta');  
        link.setAttribute('property', 'og:url');  
        link.content = document.location;  
        document.getElementsByTagName('head')[0].appendChild(link);
   
        var title = document.createElement('meta');  
        title.setAttribute('property', 'og:title');  
        title.content = news_title;
        document.getElementsByTagName('head')[0].appendChild(title);     

        var image = document.createElement('meta');  
        image.setAttribute('property', 'og:image');  
        image.content = img;  
        document.getElementsByTagName('head')[0].appendChild(image);

        var description = document.createElement('meta');  
        description.setAttribute('property', 'og:description');  
        description.content = data.excerpt;  
        document.getElementsByTagName('head')[0].appendChild(description);

        var title2 = document.createElement('meta');  
        title2.setAttribute('name', 'twitter:title');  
        title2.content = news_title;  
        $('head').append(title2);

        var description2 = document.createElement('meta');  
        description2.setAttribute('name', 'twitter:description');  
        description2.content = data.excerpt;  
        $('head').append(description2);

        var description3 = document.createElement('meta');  
        description2.setAttribute('name', 'description');  
        description2.content = data.excerpt;  
        $('head').append(description2);

        $('title').text(news_title+" - FC Zürich");
      
      html += '<div class="news-content-wrapper newsID_'+main_news_id+'">';
        html += '<div class="page-width page-width--narrow">';
      /*if(data.newsTags != null){
        var newsTags = data.newsTags;
        var totalnewsTags = newsTags.length;
        
        html += '<div class="tag-wrapper">';
        html += '<div class="tag-inner">';
        if(totalnewsTags > 0){
          for(var nt = 0; nt<totalnewsTags; nt++){
            html += '<div class="button button-small">'+newsTags[nt].translations[0].webName+'</div>';
          }
        }
        html += '<span>'+formatDate(data.createdAt)+'</span>';
        html += '</div>';
        html += '</div>';
      }*/
     
      // article.liquid server-renders the kj header (kicker/title/rule+date) whenever the
      // article drop is bound and sets this flag — emitting it here again would double it.
      if (!window.__AICO_ARTICLE_HEADER_SSR__) {
      html += '<div class="title-wrapper">';
        html += '<h2>'+news_title+'</h2>';
      html += '</div>';
        html += '<div class="tag-wrapper">';
          html += '<div class="tag-inner">';
            html +='<div class="news-category">';
          if(data.newsCategory != null ){
            var cat = data.newsCategory;
            var catName = cat.translations[0].webName;
            var catLink = STOREFRONT_PREFIX + '/blogs/news?category='+cat.id;
            if(catName == 'Profis'){
              catName = 'ERSTE MANNSCHAFT';
              catLink = '/pages/profis-erste-mannschaft';
            }else if(catName == 'Frauen'){
              catLink = '/pages/frauen-team-kader';
            }
            html += '<a href="'+catLink+'" class="news-cat">'+catName+', </a>';
          }
              html += '</div>';
          if(data.publishDate != null ){
            html += '<span class="news-date">'+formatDate(data.publishDate)+', </span>';
          }
          if(data.author != null ){
            html += '<span class="news-author">'+data.author+'</span>';
          }
          html += '</div>';
        html += '</div>';
      }
         
        html += '<div class="description-wrapper">';
        var showcontentBuilder = 'false';
        if (window.NewsNeo && window.NewsNeo.hasContent(data)) {
          showcontentBuilder = 'true';
          html += window.NewsNeo.render(data);
        }
        else if(data.contentBuilder != null){
          var rows = data.contentBuilder.rows;
          console.log(rows);
          if(rows.length > 0){
            showcontentBuilder = 'true';
            for(var row = 0; row<rows.length; row++ ){
              var columns = rows[row].columns;
              var isFullWidth = '';
              if(rows[row].order != null){
                var rowOrder = rows[row].order;
              }else{
                var rowOrder = '0';
              }
              if(rows[row].isFullWidth == 1){
                isFullWidth = 'fullwidth';
              }
              if(columns.length > 0){
                var totalColumns = columns.length;
              }else{
                var totalColumns = 0;
              }
              html += '<div class="content-row row__'+(row+1)+' '+isFullWidth+' total-columns-'+totalColumns+'" style="order:'+rowOrder+'">';
                if(columns.length > 0){
                  for(var column = 0; column < columns.length; column++){
                    var contentContainer  = columns[column].contentContainer;
                    html += '<div class="content-column column__'+(column+1)+'">';
                      if(contentContainer != null){
                        var contents = contentContainer.contents;
                        if(contents.length > 0){
                          for(var content = 0; content < contents.length; content++ ){
                            var isSplit = contents[content].isSplit;;
                            var contentData = contents[content].contentData;
                            var contentType = contents[content].type;
                            if(contents[content].containerOrder != null){
                              var containerOrder = contents[content].containerOrder;
                            }else{
                              var containerOrder = '0';
                            }
                            
                            if(contentData != null){
                              html += '<div class="content content__'+(content+1)+'" style="order:'+containerOrder+'">';

                              var translations = contentData.translations;
                              if(typeof translations !== 'undefined' && translations.length > 0){
                                for(var t=0; t<translations.length; t++){
                                  var translation = contentData.translations[t];
                                  
                                  if(translation.locale == current_locale_code ){
                                    
                                    if(contentType == 'HEADING'){
                                      if(contentData.textColor != ''){
                                        var textColor = 'color:'+contentData.textColor;
                                      }else{ var textColor = '';}
                                      html += '<div class="content-type-title">';
                                        html += '<'+contentData.titleSize+' style="'+textColor+'">';
                                          html += translation.title;
                                        html += '</'+contentData.titleSize+'>';
                                        if(translation.description != ''){
                                          html += '<p>'+translation.description+'</p>';
                                        }
                                      html += '</div>';
                                    } // end if contentType HEADING

                                    if(contentType == 'TITLE'){
                                      if(contentData.textColor != ''){
                                        var textColor = 'color:'+contentData.titleColor;
                                      }else{ var textColor = '';}
                                      html += '<div class="content-type-title">';
                                        html += '<'+contentData.size+' style="'+textColor+'">';
                                          html += translation.title;
                                        html += '</'+contentData.size+'>';
                                        
                                      html += '</div>';
                                    } // end if contentType title

                                    if(contentType == 'TEXT'){
                                      var description =translation.text;
                                      if(translation.optimizedPicture != null){
                                        var picture = translation.optimizedPicture;
                                      } else if(translation.picture != null){
                                        var picture = translation.picture;
                                      } else {
                                        var picture = '';
                                      }
                                      
                                      html += '<div class="content-type-text">';
                                      
                                      //if(picture == ''){
                                        if(translation.title != null && translation.title!=''){
                                          if(contentData.textColor != '' && contentData.textColor != null){
                                            var textColor = 'color:'+contentData.textColor;
                                          }else{ var textColor = '';}
                                          
                                          html += '<'+contentData.titleSize+' style="'+textColor+'">'+translation.title+'</'+contentData.titleSize+'>';
                                        }
                                      //}
                                        if(description != null && description != ''){
                                           if(contentData.fontSize != '' && contentData.fontSize != null ){
                                            var textSize = 'font-size:'+contentData.fontSize+'px;';
                                          }else{ var textSize = '' }
                                          if(contentData.fontFamily != '' && contentData.fontFamily != null ){
                                            var textFontFamily = 'font-family:'+contentData.fontFamily+'px;';
                                          }else{ var textFontFamily = '' }
                                          html += '<div style="'+textSize+textFontFamily+'"><p>'+description+'</p></div>';
                                        }
                                       
                                        if(picture != ''){
                                          html += '<div class="image-container image-width--'+contentData.pictureSize+' image-text--'+contentData.picturePosition+'" style="text-align:'+contentData.picturePosition+'">';
                                            html += '<div class="image-container-inner">';
                                            html += '<img src="'+picture+'" alt="" class="lazyload" loading="lazy">';
                                            if(translation.pictureLabel != null){
                                              html += '<span class="caption">'+translation.pictureLabel+'</span>';
                                            }
                                            html += '</div>';
                                          html += '</div>';
                                        }
                                      html += '</div>';
                                    } // end if contentType text

                                    if(contentType == 'BULLET'){
                                      html += '<div class="content-type-bullet">';
                                        if(translation.title != '' && translation.title != null){
                                        html += '<'+contentData.titleSize+'>'+translation.title+'</'+contentData.titleSize+'>';
                                      }
                                      if(translation.text != '' && translation.text != null){
                                        html += '<p>'+translation.text+'</p>';
                                      }
        
                                        if(contentData.bulletBullets.length > 0){
                                          html += '<ul>';
                                          for(var b = 0; b<contentData.bulletBullets.length; b++){
                                            var translations = contentData.bulletBullets[b].translations;
                                            if(translations.length > 0){
                                              for(var t=0; t<translations.length;t++){
                                                var translation = translations[t];
                                                if(translation.locale == current_locale_code){
                                                  html +='<li>'+translation.text+'</li>';
                                                }
                                              }
                                            }
                                          }
                                          html += '</ul>';
                                        }
                                      html += '</div>';
                                    } // end if contentType Bullet

                                    if(contentType == 'BLOCK_QUOTE'){
                                      html += '<div class="content-type-block_quote content-type-block_quote_'+contentData.id+'">';
                                        html += '<div class="quote-info">';
                                          if(translation.locale == current_locale_code){
                                            
                                            html += `<blockquote class="quote-text" style="color:${contentData.textColor}">
                                              ${translation.quoteText}
                                            </blockquote>`;
                                            
                                          }
                                        html += '</div>';
                                      html += '</div>';
                                      html += `<style>
                                  
                                         .content-type-block_quote_${contentData.id} .quote-text:after,
                                         .content-type-block_quote_${contentData.id} .quote-text:before{
                                              color: ${contentData.quotesColor}
                                          }
                                        </style>`;
                                    } // end if contentType BLOCK_QUOTE

                                    if(contentType == 'TABLE'){
                                    
                                      html += '<div class="content-type-table">';
                                        html += '<'+contentData.titleSize+'>'+translation.title+'</'+contentData.titleSize+'>';
                                        html += '<p>'+translation.additionalText+'</p>';
        
                                        if(contentData.tableRows != '' && contentData.tableRows != null ){
                                            html += '<table class="table table-styled">';
                                            for(var b = 0; b<contentData.tableRows.length; b++){
                                              var rowColumns = contentData.tableRows[b].rowColumns;
                                              if(rowColumns.length > 0){
                                                html += '<tr>';
                                                for(var rc=0; rc<rowColumns.length; rc++){
                                                  var translations = rowColumns[rc].translations;
                                                  for(var t=0;t<translations.length;t++){
                                                    var translation = translations[t];
                                                    
                                                    if(translation.locale == current_locale_code){
                                                      html +='<td>'+translation.columnData+'</td>';
                                                    }
                                                  }
                                                }
                                                html += '</tr>';
                                              }
                                            }
                                            html += '</table>';
                                          
                                        }
                                        
                                      html += '</div>';
                                    } // end if contentType TABLE

                                    if(contentType == 'HTML'){
                                     
                                      html += '<div class="content-type-html">';
                                        html += '<p>'+translation.text+'</p>';
                                      html += '</div>';
                                    } // end if contentType html
    
                                    if(contentType == 'LINK'){
                                    
                                      html += '<div class="content-type-link content-type-link-'+contentData.id+'">';
                                      if(translation.title != '' && translation.title != null){
                                        if(contentData.fontSize != '' && contentData.fontSize != null ){
                                          var textSize = 'font-size:'+contentData.fontSize+'px;';
                                        }else{ var textSize = '' }
                                        
                                        html += '<h3 style="'+textSize+'">'+translation.title+'</h3>';
                                      }
                                      if(translation.linkText != '' && translation.linkText != null){                                 
                                          var btnLinkClass = '';
                                          if(contentData.isButtonLink == '1'){
                                            btnLinkClass = 'button button-link';
                                            html += '<style>.content-type-link-'+contentData.id+' .button-link{background-color: '+contentData.backgroundButtonColor+';color:'+contentData.textButtonColor+'}.button-link:hover{background-color:'+contentData.hoverColor+';}</style>';
                                          }                                
                                          html += '<a href="'+translation.link+'" class="'+btnLinkClass+'">';                                
                                          if(translation.linkText != ''){
                                              html += translation.linkText;
                                          }                                  
                                          html += '</a>';
                                      }
                                      if(translation.imageUrl != '' && translation.imageUrl != null){
        
                                        html += '<div class="image-container image-width--'+contentData.pictureSize+' image-text--'+contentData.picturePosition+'" style="text-align:'+contentData.picturePosition+'">';
                                          html += '<div class="image-container-inner">';
                                            html += '<a href="'+translation.link+'">';
                                              html += '<img src="'+translation.imageUrl+'" alt="" class="lazyload" loading="lazy">';
                                            html += '</a>';
                                          html += '</div>';
                                        html += '</div>';
                                        
                                         
                                      }
                                      html += '</div>';
                                    } // end if contentType link
  
                                    if(contentType == 'VIDEO'){
                                        var videourl = translation.videoUrl;
                                        if (videourl == '' || videourl == null){
                                          videourl = contentData.videoUrl;
                                        }
                                        if (videourl == '' || videourl == null){
                                           videourl = contentData.localVideoUrl;
                                        }
                                        
                                        
                                        if(videourl!='' && videourl != null ){
                                            var videoId = youtube_parser(videourl.trim());

                                          if(videoId!=false){
                                             html += '<div class="content-type-video">';
                                              html += '<iframe title="'+translation.title+'" src="https://www.youtube.be/embed/'+videoId+'?feature=oembed&amp;enablejsapi=1&amprel=0;" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen=""></iframe>';
                                             html += '</div>';                                    
                                          } else {                                     
                                            html += '<div class="content-type-video">';
                                              var videoClass = '';
                                              if(contentData.isVideoMinimized == 1){
                                                videoClass = 'VideoMinimized';
                                              }
                                              html += '<video class="'+videoClass+'" width="80%" controls><source src="'+videourl+'"></video>';
                                            html += '</div>';                                   
                                          }
                                         
                                        }
                                                                        
                                      } // end if contentType video
  
                                    if(contentType == 'CONTENT_CARD'){
                                      html += '<div class="content-type-content-card">';
                                        html += '<'+contentData.titleSize+'>';
                                          html += translation.title;
                                        html += '</'+contentData.titleSize+'>';
                                        if(translation.text != ''){
                                          html += '<p>'+translation.text+'</p>';
                                        }
                                        if(contentData.picture != '' && contentData.picture ){
                                          html += '<img src="'+contentData.picture+'" class="lazyload" loading="lazy">'
                                        }
                                      html += '</div>';
                                    } // end if contentType CONTENT_CARD
  
                                    if(contentType == 'COLLECTION'){
                                      
                                      html += '<div class="content-type-collection">';
                                       html += '<'+contentData.titleSize+'>';
                                       html += translation.title;
                                       html += '</'+contentData.titleSize+'>';
                                       
                                       if(translation.description != null){
                                           html += '<p>'+translation.description+'</p>';
                                       }
  
                                      var fczProducts = contentData.fczProducts;
                                      if(fczProducts.length > 0){
                                                                              
                                        if(contentData.nrOfProductsVisible>4){
                                          var dynamicClass = 'slider-for-news owl-carousel';
                                        } else {
                                          var dynamicClass = '';
                                        }
                                        html += '<div class="'+dynamicClass+' product-list row collection-matrix clearfix equal-columns--clear equal-columns--outside-trim">';
                                        for(var p=0;p<fczProducts.length; p++){
                                          var product = fczProducts[p];
                                          var translations = product.translations;
                                          var proUrl = '/products/'+product.urlHandle;
                                          var proPrice = '';
                                          if(product.price.length > 0){
                                            priceCurrency = product.price[0].currencyName;
                                            priceValue = Number(product.price[0].value) || 0;
                                            // CHF prices display rounded to the NEAREST 0.05 (display only), like the legacy shop.
                                            if(String(priceCurrency).toUpperCase() === 'CHF'){
                                              priceValue = Math.round(priceValue / 0.05) * 0.05;
                                            }
                                            proPrice = priceCurrency+' '+priceValue.toFixed(2);
                                          }
                                          if(translations.length > 0){
                                            for(var t=0;t<translations.length;t++){
                                              var translation = translations[t];
                                              
                                              if(translation.locale == current_locale_code){
                                                html += '<div data-product="'+product.urlHandle+'" class="col-md-3 col-sm-2 col-xs-1 column thumbnail">';                                                
                                                  var proTitle = translation.webName;
                                                 
                                                  html += '<div class="product-wrap">';
                                                    var proImage = translation.image;
                                                    html += '<div class="news-thumbnail-images">';
                                                      html += '<a href="'+proUrl+'">';
                                                      html += '<img src="'+proImage+'" class="lazyload" alt="" width="150">';
                                                      html += '</a>';
                                                    html += '</div>';
                                                  html += '</div>';
                                                  html += '<a class="product-info__caption  gsvalidated" href="'+proUrl+'"><div class="product-details"><div class="product-title">'+proTitle+'</div><div class="product-price">'+proPrice+'</div></div></a>';
                                                html += '</div>';                                            
                                              }
                                            }
                                          }
                                        }
                                        html += '</div>';
                                      }
                                     
                                     html += '</div>';
                                     } // end collection 
                                  }
                                } // end for translation                                
                              }// end if translation length check
                              
                              /*if(contentType == 'HEADING'){
                                if(contentData.textColor != ''){
                                  var textColor = 'color:'+contentData.textColor;
                                }else{ var textColor = '';}
                                html += '<div class="content-type-title">';
                                  html += '<'+contentData.titleSize+' style="'+textColor+'">';
                                    html += contentData.translations[0].title;
                                  html += '</'+contentData.titleSize+'>';
                                  if(contentData.translations[0].description != ''){
                                    html += '<p>'+contentData.translations[0].description+'</p>';
                                  }
                                html += '</div>';
                              } // end if contentType HEADING
                              if(contentType == 'TITLE'){
                                if(contentData.textColor != ''){
                                  var textColor = 'color:'+contentData.titleColor;
                                }else{ var textColor = '';}
                                html += '<div class="content-type-title">';
                                  html += '<'+contentData.size+' style="'+textColor+'">';
                                    html += contentData.translations[0].title;
                                  html += '</'+contentData.size+'>';
                                  
                                html += '</div>';
                              } // end if contentType title
  
                              if(contentType == 'TEXT'){
                                var description = contentData.translations[0].text;
                                var picture = '';
                                if(contentData.translations[0].optimizedPicture != null){
                                  picture = contentData.translations[0].optimizedPicture; 
                                }
                                else if (contentData.translations[0].picture != null){
                                  picture = contentData.translations[0].picture; 
                                }
                                html += '<div class="content-type-text">';
                                if(picture == ''){
                                  if(contentData.translations[0].title != null){
                                    if(contentData.textColor != '' && contentData.textColor != null){
                                      var textColor = 'color:'+contentData.textColor;
                                    }else{ var textColor = '';}
                                    if(contentData.fontSize != '' && contentData.fontSize != null ){
                                      var textSize = 'font-size:'+contentData.fontSize+'px;';
                                    }else{ var textSize = '' }
                                    
                                    html += '<'+contentData.titleSize+' style="'+textSize+textColor+'">'+contentData.translations[0].title+'</'+contentData.titleSize+'>';
                                  }
                                }
                                  if(description != null ){
                                    html += description;
                                  }
                                  
                                  if(picture != ''){
                                    html += '<div class="image-container image-width--'+contentData.pictureSize+'" style="text-align:'+contentData.picturePosition+'">';
                                      html += '<div class="image-container-inner">';
                                      html += '<img src="'+picture+'" alt="" loading="lazy">';
                                      if(contentData.translations[0].pictureLabel != null){
                                        html += '<span class="caption">'+contentData.translations[0].pictureLabel+'</span>';
                                      }
                                      html += '</div>';
                                    html += '</div>';
                                  }
                                html += '</div>';
                              } // end if contentType text
  
                              if(contentType == 'BULLET'){
                                html += '<div class="content-type-bullet">';
                                  html += '<'+contentData.titleSize+'>'+contentData.translations[0].title+'</'+contentData.titleSize+'>';
                                  html += '<p>'+contentData.translations[0].text+'</p>';
  
                                  if(contentData.bulletBullets.length > 0){
                                    html += '<ul>';
                                    for(var b = 0; b<contentData.bulletBullets.length; b++){
                                      html +='<li>'+contentData.bulletBullets[b].translations[0].text+'</li>';
                                    }
                                    html += '</ul>';
                                  }
                                html += '</div>';
                              } // end if contentType Bullet
  
                              if(contentType == 'TABLE'){
                                html += '<div class="content-type-table">';
                                  html += '<'+contentData.titleSize+'>'+contentData.translations[0].title+'</'+contentData.titleSize+'>';
                                  html += '<p>'+contentData.translations[0].additionalText+'</p>';
  
                                  if(contentData.bulletBullets.length > 0){
                                    html += '<table class="table table-styled">';
                                    for(var b = 0; b<contentData.bulletBullets.length; b++){
                                      html += '<tr>';
                                      html +='<td>'+contentData.bulletBullets[b].translations[0].label+'</td>';
                                      html +='<td>'+contentData.bulletBullets[b].translations[0].content+'</td>';
                                      html += '</tr>';
                                    }
                                    html += '</table>';
                                  }
                                  
                                html += '</div>';
                              } // end if contentType TABLE
  
                              if(contentType == 'HTML'){
                                html += '<div class="content-type-html">';
                                  html += '<p>'+contentData.translations[0].text+'</p>';
                                html += '</div>';
                              } // end if contentType html
  
                              if(contentType == 'LINK'){
                                html += '<div class="content-type-link">';
                                  if(contentData.title != ''){
                                      html += '<h3>'+contentData.title+'</h3>';
                                  }
                                  var btnLinkClass = '';
                                  if(contentData.isButtonLink == '1'){
                                    btnLinkClass = 'button button-link';
                                    html += '<style>.button-link{background-color: '+contentData.backgroundButtonColor+';color:'+contentData.textButtonColor+'}.button-link:hover{background-color:'+contentData.hoverColor+';}</style>';
                                  }
                                
                                  html += '<a href="'+contentData.link+'" class="'+btnLinkClass+'">';
                                  if(contentData.linkText != ''){
                                      html += contentData.linkText;
                                  }
                                  else{
                                      html += contentData.link;
                                  }
                                  
                                  html += '</a>';
                                html += '</div>';
                              } // end if contentType link

                               if(contentType == 'VIDEO'){
                                html += '<div class="content-type-video">';
                                if(contentData.videoUrl){
                                  html += '<iframe title="'+contentData.translations[0].title+'" src="https://www.youtube.be/embed/'+youtube_parser(contentData.videoUrl)+'?feature=oembed&amp;enablejsapi=1&amprel=0;" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen=""></iframe>';
                                  //html += youtube_parser(contentData.videoUrl);
                                } else if(contentData.localVideoUrl) {
                                  var videoClass = '';
                                  if(contentData.isVideoMinimized == 1){
                                    videoClass = 'VideoMinimized';
                                  }
                                  html += '<video class="'+videoClass+'" width="80%" controls><source src="'+contentData.localVideoUrl+'"></video>';
                                }
                                html += '</div>';
                              } // end if contentType video

                              if(contentType == 'CONTENT_CARD'){
                                html += '<div class="content-type-content-card">';
                                  html += '<'+contentData.titleSize+'>';
                                    html += contentData.translations[0].title;
                                  html += '</'+contentData.titleSize+'>';
                                  if(contentData.translations[0].text != ''){
                                    html += '<p>'+contentData.translations[0].text+'</p>';
                                  }
                                  if(contentData.picture != '' && contentData.picture ){
                                    html += '<img src="'+contentData.picture+'" loading="lazy">'
                                  }
                                html += '</div>';
                              } // end if contentType CONTENT_CARD

                              */
  
                              if(contentType == 'DOCUMENT'){
                                html += '<div class="content-type-document">';
                                  if(contentData.translations[0].document != '' && contentData.translations[0].document != null){
                                      html += '<style>';
                                      html += '.document-button{ background-color:'+contentData.buttonBackgroundColor+';border: 1px solid '+contentData.buttonBorderColor+';padding: 10px;}';
                                      html += '.document-button:hover{ background-color:'+contentData.buttonHoverColor+';}';
                                      html += '.document-button a{ color:'+contentData.buttonTextColor+' !important;text-decoration: none;}';
                                      html += '</style>';
                                      if(contentData.isDocumentDisplayedAsButton == 1){
                                          var btnClass = 'document-button';
                                      }else {
                                          var btnClass = '';
                                      }
                                      html += '<button class="'+btnClass+'"><a target="_blank" href="'+contentData.translations[0].document+'">'+contentData.translations[0].title+'</a></button>';
                                  }
                                html += '</div>';
                              } // end if contentType DOCUMENT
  
  
  
                             
  
                              if(contentType == 'DIVIDER'){
                                html += '<div class="content-type-divider">';
                                  html += '<hr>';
                                html += '</div>';
                              } // end if contentType DIVIDER
  
                              
  
                              if(contentType == 'CAROUSEL'){                                
                                html += '<div class="content-type-carousel">';
                                html += '<div id="news-media-wrapper-'+((row+1)+(content+1))+'" class="news-media-wrapper">';
                                if(contentData.contentCarouselImages){
                                    var album_image = contentData.contentCarouselImages;
                                    if(album_image.length > 9){
                                      slidetoshow = 9;
                                    }
                                    html += '<div class="news-slider slider-for">';
                                    for(var ai = 0; ai < album_image.length; ai++){
                                      html += '<div class="news-images">';
                                        html += '<img src="'+album_image[ai].picture+'" width="1300" alt="">';
                                        if(album_image[ai].translations[0].title != null ){
                                          html += '<span class="caption">'+album_image[ai].translations[0].title+'</span>';
                                        }
                                      html += '</div>';
                                    }
                                    html += '</div>'; // end slider-for
                                    html += '<div class="news-thumbnail slider-nav">';
                  
                                      for(var ai = 0; ai < album_image.length; ai++){
                                        var imgSrc = '';
                                        
                                        if(album_image[ai].picture != null){
                                          imgSrc = album_image[ai].picture;
                                        }else{
                                          imgSrc = album_image[ai].picture;
                                        }
                                        html += '<div class="news-thumbnail-images">';
                                            html += '<img src="'+imgSrc+'" alt="" width="150">';
                                        html += '</div>';
                                      }
                                      html += '</div>';
      
                                    html += '</div>';
                                  html += '</div>';
                                } // end if contentType album
                              }
                              
                              if(contentType == 'ALBUM'){
                                  html += '<div id="news-media-wrapper-'+((row+1)+(content+1))+'" class="news-media-wrapper content-type-content-album" data-album="album-content-'+((row+1)+(content+1))+'">';
                                  
                                    if(contentData.album){

                                        var album_image = contentData.album.images;
                                        
                                        html += '<div class="news-slider slider-for">';
                                        
                                        if(album_image.length > 9){
                                          slidetoshow = 9;
                                        }
                                        
                                        for(var ai = 0; ai < album_image.length; ai++){
                                          var imgSrc = '';
                                          
                                          if(album_image[ai].optimizedImage != null){
                                            imgSrc = album_image[ai].optimizedImage;
                                          }else{
                                            imgSrc = album_image[ai].url;
                                          }
                                          
                                          html += '<div class="news-images" data-order="'+album_image[ai].order+'">';
                                              html += '<img src="'+imgSrc+'" width="1300" alt="">';
                                              if(album_image[ai].translations[0].alternative_text != null ){
                                                html += '<span class="caption">'+album_image[ai].translations[0].alternative_text+'</span>';
                                              }
                                          html += '</div>';
                                        }
                                        html += '</div>';
                                        
                                        html += '<div class="news-thumbnail slider-nav">';
                                        
                                        for(var ai = 0; ai < album_image.length; ai++){
                                          var imgSrc = '';
                                          
                                          if(album_image[ai].optimizedImage != null){
                                            imgSrc = album_image[ai].optimizedImage;
                                          }else{
                                            imgSrc = album_image[ai].url;
                                          }
                                          html += '<div class="news-thumbnail-images" data-thumbnail-order="'+album_image[ai].order+'">';
                                              html += '<img src="'+imgSrc+'" alt="" width="150">';
                                          html += '</div>';
                                        }
                                        html += '</div>';
                                      
                                    }
                                    
                                  
                                  html += '</div>';
                                  
                              } // endif album
                              
                              html += '</div>'; // end content
                            } // end if contentData
                          } // end for content
                        } // end if content.length
                      } // end if contentContainer
                    html += '</div>'; // end content-column
                  } // end for column
                } // end if column.length
              html += '</div>'; // end content-row  
            } // end for rows
          } // end if rows.length
        }

        if(showcontentBuilder == 'false'){
          html += data.description;
        
        var img = data.optimizedImage;
        if(data.optimizedImage == null){
          img = data.image;
        }else if(data.image == null){
          img = '';
        }

        if(data.album != null ){
            html += '<div id="news-media-wrapper-1" class="news-media-wrapper">';
            
              var album_image = data.album.images;
              
              html += '<div class="news-slider slider-for">';
              
              if(album_image.length > 9){
                slidetoshow = 9;
              }
              
              for(var ai = 0; ai < album_image.length; ai++){
                var imgSrc = '';
                
                if(album_image[ai].optimizedImage != null){
                  imgSrc = album_image[ai].optimizedImage;
                }else{
                  imgSrc = album_image[ai].url;
                }
                
                html += '<div class="news-images">';
                    html += '<img src="'+imgSrc+'" width="1300" alt="">';
                    if(album_image[ai].translations[0].caption != null ){
                      html += '<span class="caption">'+album_image[ai].translations[0].caption+'</span>';
                    }
                html += '</div>';
              }
              html += '</div>';
              
              html += '<div class="news-thumbnail slider-nav">';
              
              for(var ai = 0; ai < album_image.length; ai++){
                var imgSrc = '';
                
                if(album_image[ai].optimizedImage != null){
                  imgSrc = album_image[ai].optimizedImage;
                }else{
                  imgSrc = album_image[ai].url;
                }
                html += '<div class="news-thumbnail-images">';
                    html += '<img src="'+imgSrc+'" alt="" width="150">';
                html += '</div>';
              }
              html += '</div>';
            
            html += '</div>';

        }
            }
         
        html += '</div>';
      html += '</div>';
      html += '</div>';

        
      // match data      
      
        html += '<div class="match-details-wrapper live-match-score bg-white">';
        html += '<div class="page-width page-width--narrow">';
        
        if(data.match != null){
          var matchdata = data.match;
          var regularTimeHome = matchdata.regularTimeHome;
          var regularTimeGuest = matchdata.regularTimeGuest;
          var halfTimeHome = matchdata.halfTimeHome;
          var halfTimeGuest = matchdata.halfTimeGuest;
          
          
          html += '<div class="container--tabs match-center-main">';
          html += '<ul class="nav nav-tabs match-center-tabs">';
          html += '<li data-id="#tab-match" class="match-center active">';
          if(matchdata.id != null){     
            html += '<a href="/pages/matchcenter/'+matchdata.id+'">';
            html += '<svg xmlns="http://www.w3.org/2000/svg" width="28.087" height="28.087" viewBox="0 0 28.087 28.087"><path id="Icon_ionic-ios-football" data-name="Icon ionic-ios-football" d="M17.419,3.375A14.044,14.044,0,1,0,31.462,17.419,14.041,14.041,0,0,0,17.419,3.375Zm8.595,5.449A12.059,12.059,0,0,1,27.54,10.68a.247.247,0,0,1,.027.236l-.972,2.788a.268.268,0,0,1-.142.155L22.57,15.629a.272.272,0,0,1-.284-.041l-3.821-3.214a.277.277,0,0,1-.095-.209V7.905a.27.27,0,0,1,.122-.223L21.085,5.92a.266.266,0,0,1,.236-.034A12.3,12.3,0,0,1,26.014,8.824Zm-4.99,20.093a.249.249,0,0,1-.176.162,12.136,12.136,0,0,1-3.43.486,12.347,12.347,0,0,1-3.43-.486.28.28,0,0,1-.176-.162l-1.107-2.9a.283.283,0,0,1,.014-.223l1.506-2.856a.273.273,0,0,1,.236-.142h5.908a.265.265,0,0,1,.236.142l1.506,2.856a.283.283,0,0,1,.014.223Zm-4.551-21v4.26a.277.277,0,0,1-.095.209L12.551,15.6a.272.272,0,0,1-.284.041L8.385,13.867a.266.266,0,0,1-.142-.155L7.271,10.93a.264.264,0,0,1,.027-.236,12.241,12.241,0,0,1,6.225-4.78.266.266,0,0,1,.236.034L16.352,7.71A.223.223,0,0,1,16.473,7.919ZM5.38,17.966l2.437-2.107a.27.27,0,0,1,.29-.041l3.538,1.607a.27.27,0,0,1,.149.182l.986,3.869a.323.323,0,0,1-.02.2l-1.566,2.964a.263.263,0,0,1-.243.142l-3.106-.041a.282.282,0,0,1-.216-.108,12.067,12.067,0,0,1-2.343-6.441A.3.3,0,0,1,5.38,17.966ZM23.637,24.63l-1.56-2.957a.248.248,0,0,1-.02-.2l.986-3.869a.27.27,0,0,1,.149-.182l3.538-1.607a.284.284,0,0,1,.29.041l2.437,2.107a.273.273,0,0,1,.095.223,12.031,12.031,0,0,1-2.343,6.441.262.262,0,0,1-.216.108l-3.113.041A.3.3,0,0,1,23.637,24.63Z" transform="translate(-3.375 -3.375)" fill="#fff"></path></svg>';
            html += 'Zum MATCHCENTER</a>';
          }else {
            html += '<a>';
            html += '<svg xmlns="http://www.w3.org/2000/svg" width="28.087" height="28.087" viewBox="0 0 28.087 28.087"><path id="Icon_ionic-ios-football" data-name="Icon ionic-ios-football" d="M17.419,3.375A14.044,14.044,0,1,0,31.462,17.419,14.041,14.041,0,0,0,17.419,3.375Zm8.595,5.449A12.059,12.059,0,0,1,27.54,10.68a.247.247,0,0,1,.027.236l-.972,2.788a.268.268,0,0,1-.142.155L22.57,15.629a.272.272,0,0,1-.284-.041l-3.821-3.214a.277.277,0,0,1-.095-.209V7.905a.27.27,0,0,1,.122-.223L21.085,5.92a.266.266,0,0,1,.236-.034A12.3,12.3,0,0,1,26.014,8.824Zm-4.99,20.093a.249.249,0,0,1-.176.162,12.136,12.136,0,0,1-3.43.486,12.347,12.347,0,0,1-3.43-.486.28.28,0,0,1-.176-.162l-1.107-2.9a.283.283,0,0,1,.014-.223l1.506-2.856a.273.273,0,0,1,.236-.142h5.908a.265.265,0,0,1,.236.142l1.506,2.856a.283.283,0,0,1,.014.223Zm-4.551-21v4.26a.277.277,0,0,1-.095.209L12.551,15.6a.272.272,0,0,1-.284.041L8.385,13.867a.266.266,0,0,1-.142-.155L7.271,10.93a.264.264,0,0,1,.027-.236,12.241,12.241,0,0,1,6.225-4.78.266.266,0,0,1,.236.034L16.352,7.71A.223.223,0,0,1,16.473,7.919ZM5.38,17.966l2.437-2.107a.27.27,0,0,1,.29-.041l3.538,1.607a.27.27,0,0,1,.149.182l.986,3.869a.323.323,0,0,1-.02.2l-1.566,2.964a.263.263,0,0,1-.243.142l-3.106-.041a.282.282,0,0,1-.216-.108,12.067,12.067,0,0,1-2.343-6.441A.3.3,0,0,1,5.38,17.966ZM23.637,24.63l-1.56-2.957a.248.248,0,0,1-.02-.2l.986-3.869a.27.27,0,0,1,.149-.182l3.538-1.607a.284.284,0,0,1,.29.041l2.437,2.107a.273.273,0,0,1,.095.223,12.031,12.031,0,0,1-2.343,6.441.262.262,0,0,1-.216.108l-3.113.041A.3.3,0,0,1,23.637,24.63Z" transform="translate(-3.375 -3.375)" fill="#fff"></path></svg>';
            html += 'Zum MATCHCENTER</a>';
          }
          html += '</li>';
          /*if(matchdata.guestClubLineup != null && matchdata.homeClubLineup != null){
          html += '<li data-id="#tab-4" class="aufstellung">';
          html += '<svg xmlns="http://www.w3.org/2000/svg" width="32.073" height="25.655" viewBox="0 0 32.073 25.655"><path id="Icon_awesome-tshirt" data-name="Icon awesome-tshirt" d="M31.626,4.835,21.87,0c-1.007,1.393-3.237,2.365-5.837,2.365S11.2,1.393,10.2,0L.44,4.835A.808.808,0,0,0,.079,5.913L2.945,11.65a.808.808,0,0,0,1.077.361l2.836-1.388a.8.8,0,0,1,1.152.722V24.051a1.6,1.6,0,0,0,1.6,1.6H22.442a1.6,1.6,0,0,0,1.6-1.6V11.339a.8.8,0,0,1,1.152-.722l2.836,1.388a.8.8,0,0,0,1.077-.361l2.871-5.732a.8.8,0,0,0-.356-1.077Z" transform="translate(0.004)" fill="#fff"></path></svg>';
          html += '<a>AUFSTELLUNG</a>';
          html += '</li>'; 
          }*/
          html += '</ul>';
          
          html += '<div class="tab-content">';
          
          html += '<div id="tab-match" class="tab-pane active">';

          if (regularTimeHome == null && regularTimeGuest == null) {
            var score = 'VS';
          } else {
          var scoreClass = '';
          var iSNP = false;
          var isnV = false;
          if((matchdata.atForfeitHome != null && matchdata.atForfeitGuest != null) && (matchdata.atForfeitHome != 0 && matchdata.atForfeitGuest != 0) ){
            regularTimeHome = matchdata.atForfeitHome;
            regularTimeGuest = matchdata.atForfeitGuest;
            scoreClass = 'hidden';
          }else if((matchdata.penaltyShootoutHome != null && matchdata.penaltyShootoutGuest != null) && (matchdata.penaltyShootoutHome != 0 && matchdata.penaltyShootoutGuest != 0)){
            regularTimeHome = matchdata.penaltyShootoutHome;
            regularTimeGuest = matchdata.penaltyShootoutGuest;
            iSNP = true;
            scoreClass = 'hidden';
          }else if((matchdata.extraTimeHome != null && matchdata.extraTimeGuest != null) && (matchdata.extraTimeHome != 0 && matchdata.extraTimeGuest != 0)){
            regularTimeHome = matchdata.extraTimeHome;
            regularTimeGuest = matchdata.extraTimeGuest;
            isnV = true;
            scoreClass = 'hidden';
          }
          else if (matchdata.regularTimeHome != null && matchdata.regularTimeGuest != null){
            regularTimeHome = matchdata.regularTimeHome;;
            regularTimeGuest = matchdata.regularTimeGuest;
          }
          var score = regularTimeHome + ':' + regularTimeGuest;
        }

          
          if(matchdata.status == 'FIRST HALF'){
            if(matchdata.regularTimeHome != null && matchdata.regularTimeGuest != null){
              regularTimeHome = matchdata.halfTimeHome;
              regularTimeGuest = matchdata.halfTimeGuest;
              var score = regularTimeHome + ':' + regularTimeGuest;
            }
          }
          if((matchdata.regularTimeHome == null && matchdata.regularTimeGuest == null) && matchdata.halfTimeHome != null && matchdata.halfTimeGuest != null ){
            regularTimeHome = matchdata.halfTimeHome;
            regularTimeGuest = matchdata.halfTimeGuest;
            var score = regularTimeHome + ':' + regularTimeGuest;
          }
          var soccerHighlights = matchdata.soccerHighlights;

          var teamA = '';
          var teamB = '';
          for(var a=0; a<soccerHighlights.length; a++){
            if(soccerHighlights[a].club == 'Home' && soccerHighlights[a].highlightType == "Mark goal"){
              teamA += '<div class="highlight" style="order:'+ soccerHighlights[a].minute +'"><div class="highlight__type"><span class="live__icon live__icon--goal"></span></div><div class="highlight__player"><strong>'+soccerHighlights[a].player+'</strong> ('+soccerHighlights[a].minute+')</div></div>';
            }
            else if(soccerHighlights[a].club == 'Guest' && soccerHighlights[a].highlightType == "Mark goal"){
              teamB += '<div class="highlight" style="order:'+ soccerHighlights[a].minute +'"><div class="highlight__type"><span class="live__icon live__icon--goal"></span></div><div class="highlight__player"><strong>'+soccerHighlights[a].player+'</strong> ('+soccerHighlights[a].minute+')</div></div>';
            }
          }
          for(var b=0; b<soccerHighlights.length; b++){
            if(soccerHighlights[b].club == 'Home' && soccerHighlights[b].highlightType == "Mark yellow card"){
              teamA += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--yellowcard"></span></div><div class="highlight__player"><strong>'+soccerHighlights[b].player+'</strong> ('+soccerHighlights[b].minute+')</div></div>';
            }
            else if(soccerHighlights[b].club == 'Guest' && soccerHighlights[b].highlightType == "Mark yellow card"){
              teamB += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--yellowcard"></span></div><div class="highlight__player"><strong>'+soccerHighlights[b].player+'</strong> ('+soccerHighlights[b].minute+')</div></div>';
            }
          }
          for(var b=0; b<soccerHighlights.length; b++){
            if(soccerHighlights[b].club == 'Home' && soccerHighlights[b].highlightType == "Mark red card"){
              teamA += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--redcard"></span></div><div class="highlight__player"><strong>'+soccerHighlights[b].player+'</strong> ('+soccerHighlights[b].minute+')</div></div>';
            }
            else if(soccerHighlights[b].club == 'Guest' && soccerHighlights[b].highlightType == "Mark red card"){
              teamB += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--redcard"></span></div><div class="highlight__player"><strong>'+soccerHighlights[b].player+'</strong> ('+soccerHighlights[b].minute+')</div></div>';
            }
          }
          for (var b = 0; b < soccerHighlights.length; b++) {
            if (soccerHighlights[b].club == 'Home' && soccerHighlights[b].highlightType == "Mark yellow red card") {
              teamA += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--yellowredcard"></span></div><div class="highlight__player"><strong>' + soccerHighlights[b].player + '</strong> (' + soccerHighlights[b].minute + ')</div></div>';
            } else if (soccerHighlights[b].club == 'Guest' && soccerHighlights[b].highlightType == "Mark yellow red card") {
              teamB += '<div class="highlight" style="order:'+ soccerHighlights[b].minute +'"><div class="highlight__type"><span class="live__icon live__icon--yellowredcard"></span></div><div class="highlight__player"><strong>' + soccerHighlights[b].player + '</strong> (' + soccerHighlights[b].minute + ')</div></div>';
            }
          }

          html += '<div class="news-match-details">';
            html += '<div class="current-match-wrapper">';
                html += '<div class="match-wrapper-inner">';
                  if(matchdata.homeClub != null){
                    html += '<div class="team-1">';
                        html += '<div class="team-img">';
                            html += '<img src="'+matchdata.homeClub.logo+'" alt="">';
                        html += '</div>';
                        html += '<h2 class="team-name">'+matchdata.homeClub.name+'</h2>';
                    html += '</div>';
                  }
                    html += '<div class="team-score-wrapper">';
                      html += '<div class="team-score">'+score+'</div>';
                      if(iSNP == true){
                        html += '<div class="team-time">n.P.</div>';
                        if((matchdata.extraTimeHome != null && matchdata.extraTimeGuest != null) && (matchdata.extraTimeHome != 0 && matchdata.extraTimeGuest != 0)){
                          html += '<div class="team-time">('+matchdata.extraTimeHome+':'+matchdata.extraTimeGuest+') n.V.</div>';
                        }
                      }
                      if(isnV == true){
                        html += '<div class="team-time">n.V.</div>';
                      }
                      if(isnV == true || iSNP == true){
                        if (matchdata.regularTimeHome != null && matchdata.regularTimeGuest != null){
                          html += '<div class="team-time">('+matchdata.regularTimeHome+':'+matchdata.regularTimeGuest+') 90\'</div>';
                        }
                        if(halfTimeHome != null && halfTimeGuest != null){
                          html += '<div class="team-time">('+halfTimeHome+':'+halfTimeGuest+') 45\'</div>';
                        }
                      }
                      if(halfTimeHome != null && halfTimeGuest != null){
                        html += '<div class="team-time '+scoreClass+'">('+halfTimeHome+':'+halfTimeGuest+')</div>';
                      }
                    html += '</div>';
                  if(matchdata.guestClub != null){
                    html += '<div class="team-2">';
                        html += '<div class="team-img">';
                            html += '<img src="'+matchdata.guestClub.logo+'" alt="">';
                        html += '</div>';
                        html += '<h2 class="team-name">'+matchdata.guestClub.name+'</h2>';
                    html += '</div>';
                  }
                html += '</div>';
            html += '</div>';
            html += '<div class="live__matchinfo live__matchinfo--article-display">';
                html += '<div class="live_matchinfo live__matchinfo__highlights">';
                    html += '<div class="live__highlights">';
                        html += '<div class="row">';
                            html += '<div class="columns small-6 medium-5 team-1">'+teamA+'</div>';
                            html += '<div class="columns small-6 medium-5 team-2 medium-offset-2">'+teamB+'</div>';
                        html += '</div>';
                    html += '</div>';
                    html += '<div class="live__highlights__info row">';
                        if (matchdata.arenaName != null && matchdata.arenaName != "") {
                            if (matchdata.arenaCity != null && matchdata.arenaCity != '') {
                                var arenaCity = ', ' + matchdata.arenaCity;
                            } else {
                                var arenaCity = '';
                            }                            
                           html += '<div class="columns small-12 medium-6 stadium-wrapper"><span><strong>'+matchdata.arenaName + arenaCity +'</strong></span></div>';
                        }
                        if (matchdata.numberOfSpectators == null) {                            
                        } else if (matchdata.numberOfSpectators == 0) {                            
                        } else {                            
                            html += '<div class="columns small-12 medium-6 zuschauer-wrapper"><span> '+matchdata.numberOfSpectators+' ZUSCHAUER</span></div>';
                        }

                        if (matchdata.refereeName != null && matchdata.refereeName != "") {                            
                            html += '<div class="columns small-12 medium-6 rafree-wrapper"><span><strong> SCHIEDSRICHTER</strong> '+matchdata.refereeName+'</span></div>';
                        } else {                            
                        }
                    html += '</div>';
                html += '</div>';
            html += '</div>';
          
          html += '</div>';
          html += '</div>';
          /*
          if(matchdata.guestClubLineup != null && matchdata.homeClubLineup != null) {
                       
            html += '<div id="tab-4" class="tab-pane">';
            html += '<div class="tab-pane-content tab-pane-content-aufstellung">';
              html += '<div class="slick-aufstellung">';
                html += '<div class="aufstellung-main ersatzbank ersatzbank-home">';
                  html += '<div class="aufstellung-left">';
                    html += '<div class="team-1">';
                      html += '<div class="team-img"></div>';
                      html += '<h2 class="team-name">ERSATZBANK</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list ersatzbank-list-1"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="home-betch-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                  html += '<div class="aufstellung-right">';
                    html += '<div class="team-2">';
                      if(matchdata.homeClub.logo != null) {
                          html += '<div class="team-img">';
                              html += '<img src="' + matchdata.homeClub.logo + '" width="300" alt="">';
                          html += '</div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-1">';
                    html += '</ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="home-lineup-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
                html += '<div class="aufstellung-main aufstellung">';
                  html += '<div class="aufstellung-left">';
                    html += '<div class="team-1">';
                      if(matchdata.homeClub.logo != null) {
                          html += '<div class="team-img">';
                              html += '<img src="' + matchdata.homeClub.logo + '" width="300" alt="">';
                          html += '</div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-1"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="home-team-trainer"></p>';
                    html += '</div>';
                  html += '</div>';

                  html += '<div class="aufstellung-center">';
                  html += '<h2 class="home-team-name">'+matchdata.homeClub.name+'</h2>';
                  html += '<div class="lineup-field-wrapper">';
                    html += '<div class="team-one-player-list">'; html += '</div>';
                    html += '<div class="team-two-player-list">'; html += '</div>';
                  html += '</div>';
                  html += '<h2 class="guest-team-name">'+matchdata.guestClub.name+'</h2>';
                  html += '</div>';
            
                  html += '<div class="aufstellung-right">';
                    html += '<div class="team-2">';
                      if(matchdata.guestClub.logo != null) {
                          html += '<div class="team-img">';
                              html += '<img src="' + matchdata.guestClub.logo + '" width="300" alt="">';
                          html += '</div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-2"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="guest-team-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
                html += '<div class="aufstellung-main ersatzbank ersatzbank-guest">';

                  html += '<div class="aufstellung-right">';
                    html += '<div class="team-2">';
                      if(matchdata.guestClub.logo != null) {
                          html += '<div class="team-img">';
                              html += '<img src="' + matchdata.guestClub.logo + '" width="300" alt="">';
                          html += '</div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-2"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="guest-lineup-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
            
                  html += '<div class="aufstellung-left">';
                    html += '<div class="team-1">';
                      html += '<div class="team-img"></div>';
                      html += '<h2 class="team-name">ERSATZBANK</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list ersatzbank-list-2"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="guest-betch-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                 
                html += '</div>';
              html += '</div>';

              
              html += '<div class="slick-aufstellung-mobile">';
                html += '<div class="aufstellung-main aufstellung aufstellung-home">';
                  html += '<div class="aufstellung-wrap">';
                    html += '<div class="team-1">';
                      if(matchdata.homeClub.logo != null){
                        html += '<div class="team-img"> <img src="'+matchdata.homeClub.logo+'" width="300" alt=""> </div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-1"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="home-team-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
                html += '<div class="aufstellung-main ersatzbank ersatzbank-home">';
                  html += '<div class="aufstellung-wrap">';
                    html += '<div class="team-1">';
                      html += '<h2 class="team-name">ERSATZBANK</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list ersatzbank-list-1"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="home-betch-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
                html += '<div class="aufstellung-main aufstellung aufstellung-guest">';
                  html += '<div class="aufstellung-wrap">';
                    html += '<div class="team-2">';
                      if(matchdata.guestClub.logo != null ){
                        html += '<div class="team-img"> <img src="'+matchdata.guestClub.logo+'" width="300" alt=""> </div>';
                      }
                      html += '<h2 class="team-name">AUFSTELLUNG</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list aufstellung-list-2"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="guest-team-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
                html += '<div class="aufstellung-main ersatzbank ersatzbank-guest">';
                  html += '<div class="aufstellung-wrap">';
                    html += '<div class="team-1">';
                      html += '<h2 class="team-name">ERSATZBANK</h2>';
                    html += '</div>';
                    html += '<ul class="aufstellung-list ersatzbank-list-2"> </ul>';
                    html += '<div class="aufstellung-head">';
                      html += '<h6> Cheftrainer</h6>';
                      html += '<p class="guest-betch-trainer"></p>';
                    html += '</div>';
                  html += '</div>';
                html += '</div>';
              html += '</div>';
            html += '</div>';
          html += '</div>';

          } */
          
          html += '</div>';
          html += '</div>';
        }

        html += '</div>';
        html += '</div>';

        
       // Related NEWS
        html += '<div class="related-news-wrapper match-details-wrapper">';
        html += '<div class="page-width page-width--narrow">';
          html += '<div class="related-news">';
            var current_news = false;
            for(var nz=0; nz<totalNewsData; nz++){
              var json_response = responsen.data[nz].attributes;
              var imagesrc = '';
              
              var title = jQuery.trim(json_response.name);
              var description = '';
              
              
              if(json_response.optimizedListImage != null){
                imagesrc = json_response.optimizedListImage;
              }else if(json_response.optimizedImage != null){
                imagesrc = json_response.optimizedImage;
              }else if(json_response.image != null){
                imagesrc = json_response.image;
              }else{
                imagesrc = 'https://cdn.shopify.com/s/files/1/0565/2201/4813/files/news-blank-image.png';
              }

              if(json_response.excerpt != null){
                description = json_response.excerpt;
              }else {
                description = '';
              }

              var focusXPercentage = "";
              if(json_response.focusXPercentage != null && json_response.focusXPercentage >= 0 && json_response.focusXPercentage <= 100){
                focusXPercentage = json_response.focusXPercentage+'%';
              }else {
                focusXPercentage = 'center';
              }

              var focusYPercentage = "";
              if(json_response.focusYPercentage != null && json_response.focusYPercentage >= 0 && json_response.focusYPercentage <= 100){
                focusYPercentage = json_response.focusYPercentage+'%';
              }else {
                focusYPercentage = 'center';
              }
                
              /*if(description.length > 150){
                description = jQuery.trim(json_response.description).substring(0, 150).split(" ").slice(0, -2).join(" ").replace(/(<([^>]+)>)/ig, '') + "...";
                // description = description.slice(0, -5).toString().replace(/<[^>]*>/g, '');
              }*/
              
              /*if(title.length > 50){
                title = jQuery.trim(json_response.name).substring(0, 50).split(" ").slice(0, -1).join(" ") + "...";
              }*/
              var url= STOREFRONT_PREFIX + '/blogs/news/'+responsen.data[nz].id;
              if(json_response.urlHandle != null){
                url = STOREFRONT_PREFIX + '/blogs/news/'+json_response.urlHandle;
              }

              if(main_news_id == responsen.data[nz].id){                
                current_news = true;                
                continue;
              }
              else if(nz == 4 && current_news == false){                
                continue;
              }
             //console.log(main_news_id,responsen.data[nz].id,current_news,json_response.urlHandle);
              
              html += '<div class="content-container">';
                html += '<div class="news__image-wrapper">';
                  html += '<img class="news__image" src="'+imagesrc+'" alt="" height="366" width="406" loading="lazy" style="object-position: '+focusXPercentage+' '+focusYPercentage+'">';

                  html += '<span class="badge">'+formatDateString(json_response.publishDate,'','false')+'</span>';

                html += '</div>';
                html += '<div class="news__info"><h3>'+title+'</h3><div class="rte">'+description+'</div></div>';
                html += '<div class="link-wrapper">';
                  html += '<a href="'+url+'" class="block-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M256 64C256 46.33 270.3 32 288 32H415.1C415.1 32 415.1 32 415.1 32C420.3 32 424.5 32.86 428.2 34.43C431.1 35.98 435.5 38.27 438.6 41.3C438.6 41.35 438.6 41.4 438.7 41.44C444.9 47.66 447.1 55.78 448 63.9C448 63.94 448 63.97 448 64V192C448 209.7 433.7 224 416 224C398.3 224 384 209.7 384 192V141.3L214.6 310.6C202.1 323.1 181.9 323.1 169.4 310.6C156.9 298.1 156.9 277.9 169.4 265.4L338.7 96H288C270.3 96 256 81.67 256 64V64zM0 128C0 92.65 28.65 64 64 64H160C177.7 64 192 78.33 192 96C192 113.7 177.7 128 160 128H64V416H352V320C352 302.3 366.3 288 384 288C401.7 288 416 302.3 416 320V416C416 451.3 387.3 480 352 480H64C28.65 480 0 451.3 0 416V128z"></path></svg></a>';
                html += '</div>';
              html += '</div>';
            }
            
          html += '</div>';
        html += '<div class="center"><a class="button button--primary" href="'+STOREFRONT_PREFIX+'/blogs/news">Alle Nachrichten ansehen</a></div>';
        html += '</div>';
        html += '</div>';
        
        // Strip empty paragraphs (e.g. <p>&nbsp;</p>) that editors leave in the content
        // builder. Done as a single string pass before injection (cheaper than walking
        // the DOM). Only paragraphs containing nothing but whitespace/&nbsp;/<br> match.
        html = html.replace(/<p[^>]*>(?:\s|&nbsp;|&#160;| |<br\s*\/?>)*<\/p>/gi, '');
        $('#news-details-container').html(html);
        if (window.NewsNeo && typeof window.NewsNeo.hydrate === 'function') {
          window.NewsNeo.hydrate(document.getElementById('news-details-container'));
        }
        $('.content-type-content-album').each(function(i){
          var albumContainer = $(this).attr('data-album');
          $('#news-details-container .content-type-content-album[data-album="'+albumContainer+'"] .news-slider').html($('#news-details-container .content-type-content-album[data-album="'+albumContainer+'"] .news-slider .news-images').sort(function(x, y) {
           var value_x = $(x).data('order');
           var arr_x = [];
           arr_x = value_x
                
           var value_y = $(y).data('order');
           var arr_y = [];
           arr_y = value_y
      
           var arel = parseInt( arr_x);
           var brel = parseInt(arr_y);             
      
          return arel < brel ? -1 : 1;
         }));
  
          $('#news-details-container .content-type-content-album[data-album="'+albumContainer+'"] .news-thumbnail').html($('#news-details-container .content-type-content-album[data-album="'+albumContainer+'"] .news-thumbnail .news-thumbnail-images').sort(function(x, y) {
           var value_x = $(x).data('thumbnail-order');
           var arr_x = [];
           arr_x = value_x
                
           var value_y = $(y).data('thumbnail-order');
           var arr_y = [];
           arr_y = value_y
      
           var arel = parseInt( arr_x);
           var brel = parseInt(arr_y);             
      
          return arel < brel ? -1 : 1;
         }));
      })
    
      destroyCarousel();
      setTimeout(function(){
        slickCarousel();
      },1000);

        if(has_inApp == 'true'){
          $("#MainContent #news-details-container .match-details-wrapper").hide();
          $("#MainContent #news-details-container .related-news-wrapper").hide();
        }

        // Fire a custom event after news is loaded and rendered
        const event = new Event('newsLoaded');
        document.dispatchEvent(event);
        
        if(data.match != null){
        if (matchdata.homeClubLineup != null) {
          var playerTeamA = '';
          var playerTeamA_batch = '';
          var homeCluball = matchdata.homeClubLineup.split('Ersatz');
          var str1 = matchdata.homeClubLineup;
          var str = "\r\n";
          if(str1.indexOf(str) != -1){
             var homeClubLineup = homeCluball[0].split('\r\n');
             var homeClubbatch = homeCluball[1].split('\r\n');
          }else
          {
            var homeClubLineup = homeCluball[0].split('\n');
            var homeClubbatch = homeCluball[1].split('\n');
          }
    
          for (var hc = 0; hc < homeClubLineup.length; hc++) {
    
            var teamas = '';
            var player = homeClubLineup[hc].split(',');
    
            if (player[0] != '' && typeof player[0] !== 'undefined') {
    
              if (player[2] != '' && typeof player[2] !== 'undefined') {
                teamas = '<span class="inout">' + player[2].replace('|inout', '') + '</span>';
              }
              if (typeof player[1] === 'undefined') {} else {
                playerTeamA += '<li>' + player[0] + ' ' + player[1] + teamas + '</li>';
              }
            }
          }
    
          $('.aufstellung .aufstellung-list-1').html(playerTeamA);
          $('.ersatzbank-home .aufstellung-list-1').html(playerTeamA);
          $('.aufstellung .aufstellung-head').hide();
          $('.ersatzbank-home .aufstellung-head').hide();
    
          for (var hc = 0; hc < homeClubbatch.length; hc++) {
            var teamas = '';
            var player = homeClubbatch[hc].split(',');
            if (player[0] != '' && typeof player[0] !== 'undefined') {
              if (player[2] != '' && typeof player[2] !== 'undefined') {
                teamas = '<span class="inout">' + player[2].replace('|inout', '') + '</span>';
              }
              if (typeof player[1] === 'undefined') {} else {
                playerTeamA_batch += '<li>' + player[0] + ' ' + player[1] + teamas + '</li>';
              }
            }
          }
          $('.ersatzbank-home .ersatzbank-list-1').html(playerTeamA_batch);

          var hometeam_lineup_players_pos_html = '';
            if(homeClubLineup[0].indexOf(',') != -1){ 
                  var b = 1;
                }else {
                  var b = 0;
                }
            for (var a = 0; a < homeClubLineup.length; a++) {

                var player = homeClubLineup[a].split(',');

                if (player[0] != '' && typeof player[0] !== 'undefined') {
                    if (player[2] != '' && typeof player[2] !== 'undefined') {}
                    if (typeof player[1] === 'undefined') {} else {
                        hometeam_lineup_players_pos_html += '<span class="plyr p' + b + '">' + player[0] + '</span>';
                    }
                }

               b++;

            }
            $('.aufstellung-main.aufstellung .lineup-field-wrapper .team-one-player-list').html(hometeam_lineup_players_pos_html);
          
        }
      
        if (matchdata.guestClubLineup != null) {
          var guestCluball = matchdata.guestClubLineup.split('Ersatz');
          var str1 = matchdata.guestClubLineup;
          var str = "\r\n";
          if(str1.indexOf(str) != -1){
            var guestClubLineup = guestCluball[0].split('\r\n');
            var guestClubbatch = guestCluball[1].split('\r\n');
          }else
          {
            var guestClubLineup = guestCluball[0].split('\n');
            var guestClubbatch = guestCluball[1].split('\n');
          }
          
          var playerTeamB = '';
          var playerTeamB_batch = '';
    
          for (var hc = 0; hc < guestClubLineup.length; hc++) {
            var teambs = '';
            var player = guestClubLineup[hc].split(',');
            if (player[0] != '' && typeof player[0] !== 'undefined') {
              if (player[2] != '' && typeof player[2] !== 'undefined') {
                teambs = '<span class="inout">' + player[2].replace('|inout', '') + '</span>';
              }
              if (typeof player[1] === 'undefined') {} else {
                playerTeamB += '<li>' + player[0] + ' ' + player[1] + teambs + '</li>';
              }
            }
          }
    
          $('.aufstellung .aufstellung-list-2').html(playerTeamB);
          $('.ersatzbank-guest .aufstellung-list-2').html(playerTeamB);
          $('.aufstellung .aufstellung-head').hide();
          $('.ersatzbank-guest .aufstellung-head').hide();
    
          for (var hc = 0; hc < guestClubbatch.length; hc++) {
            var teambs = '';
            var player = guestClubbatch[hc].split(',');
            if (player[0] != '' && typeof player[0] !== 'undefined') {
              if (player[2] != '' && typeof player[2] !== 'undefined') {
                teambs = '<span class="inout">' + player[2].replace('|inout', '') + '</span>';
              }
              if (typeof player[1] === 'undefined') {} else {
                playerTeamB_batch += '<li>' + player[0] + ' ' + player[1] + teambs + '</li>';
              }
            }
          }
    
          $('.ersatzbank-guest .ersatzbank-list-2').html(playerTeamB_batch);
          
          var guestteam_lineup_players_pos_html = '';
          
           if(guestClubLineup[0].indexOf(',') != -1){ 
                  var b = 1;
                }else {
                  var b = 0;
                }
            for (var a = 0; a < guestClubLineup.length; a++) {
                
                var player = guestClubLineup[a].split(',');

                if (player[0] != '' && typeof player[0] !== 'undefined') {
                    if (player[2] != '' && typeof player[2] !== 'undefined') {}
                    if (typeof player[1] === 'undefined') {} else {
                        guestteam_lineup_players_pos_html += '<span class="plyr p' + b + '">' + player[0] + '</span>';
                    }
                }

                b++;

            }
            $('.aufstellung-main.aufstellung .lineup-field-wrapper .team-two-player-list').html(guestteam_lineup_players_pos_html);
          
        }
        }
        
      });
    }
    else
    {
      
      $('#status').fadeOut();
      $('#preloader').fadeOut('slow');
    
      html += '<div class="grid grid--4-col-desktop grid--2-col-tablet-down">';

      if(totalData<1){
        html += '<p style="color:#fff">Nachrichten sind nicht verfügbar.</p>';
      }

      for(var a=0; a<totalData; a++){
        var json_response = response.data[a].attributes;
        var imagesrc = '';
        var title = jQuery.trim(json_response.name);
        var description = '';

        if(json_response.excerpt != null){
          description = json_response.excerpt;
        }else {
          description = '';
        }

        var translations = response.data[a].attributes.translations;
        if(translations.length>0){
          for(var t=0;t<translations.length;t++){
            var translation = translations[t];
            // console.log(translation);
            if(translation.locale == current_locale_code ){
              
              title = jQuery.trim(translation.name);
              if(translation.excerpt != null){
                description = translation.excerpt;
              }else {
                description = '';
              }
            }
          }
        }
          
        /*if(description.length > 150){
          description = jQuery.trim(json_response.description).substring(0, 150).split(" ").slice(0, -2).join(" ").replace(/<[^>]*>/g, '') + "...";
          // description = description.slice(0, -5).toString().replace(/<[^>]*>/g, '');
        }
        if(title.length > 50){
          title = jQuery.trim(json_response.name).substring(0, 50).split(" ").slice(0, -1).join(" ") + "...";
        }*/

        /*if(json_response.optimizedListImage != null){
          imagesrc = json_response.optimizedListImage;
        }else*/ if(json_response.optimizedImage != null){
          imagesrc = json_response.optimizedImage;
        }else if(json_response.image != null){
          imagesrc = json_response.image;
        }else{
          imagesrc = 'https://cdn.shopify.com/s/files/1/0565/2201/4813/files/news-blank-image.png';
        }

         var focusXPercentage = "";
        if(json_response.focusXPercentage != null && json_response.focusXPercentage != '' && json_response.focusXPercentage >= 0 && json_response.focusXPercentage <= 100){
          focusXPercentage = json_response.focusXPercentage+'%';
        }else {
          focusXPercentage = 'center';
        }

        var focusYPercentage = "";
        if(json_response.focusYPercentage != null && json_response.focusYPercentage != '' && json_response.focusYPercentage >= 0 && json_response.focusYPercentage <= 100){
          focusYPercentage = json_response.focusYPercentage+'%';
        }else {
          focusYPercentage = 'center';
        }
        
        var newscat = '';
        if(json_response.newsCategory !== null ){

          for(var nc=0; nc <json_response.newsCategory.translations.length; nc++){
              newscat += ' '+json_response.newsCategory.translations[nc].webName;
          }
        }
        
        var url=response.data[a].id;
        if(response.data[a].attributes.urlHandle != null){
          var url = response.data[a].attributes.urlHandle;
        }

          html += '<div class="grid__item'+newscat+'">';
              html += '<div class="news-wrapper">';
                  html += '<div class="image-wrapper">';
                      html += '<img src="'+imagesrc+'" width="320" loading="lazy" style="object-position: '+focusXPercentage+' '+focusYPercentage+'">';
                  html += '</div>';
                  html += '<div class="content-wrapper">';
                      html += '<div class="newsblock__date">'+formatDateString(response.data[a].attributes.publishDate,'regular','false')+'</div>';
                      html += '<h3 class="newsblock__title">'+title+'</h3>';
                      html += '<div class="newsblock__details">'+description+'</div>';
                  html += '</div>';
                  html += '<div class="link-wrapper">';
                      html +='<a href="'+STOREFRONT_PREFIX+'/blogs/news/'+url+'" class="block-btn">';
                          html += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M256 64C256 46.33 270.3 32 288 32H415.1C415.1 32 415.1 32 415.1 32C420.3 32 424.5 32.86 428.2 34.43C431.1 35.98 435.5 38.27 438.6 41.3C438.6 41.35 438.6 41.4 438.7 41.44C444.9 47.66 447.1 55.78 448 63.9C448 63.94 448 63.97 448 64V192C448 209.7 433.7 224 416 224C398.3 224 384 209.7 384 192V141.3L214.6 310.6C202.1 323.1 181.9 323.1 169.4 310.6C156.9 298.1 156.9 277.9 169.4 265.4L338.7 96H288C270.3 96 256 81.67 256 64V64zM0 128C0 92.65 28.65 64 64 64H160C177.7 64 192 78.33 192 96C192 113.7 177.7 128 160 128H64V416H352V320C352 302.3 366.3 288 384 288C401.7 288 416 302.3 416 320V416C416 451.3 387.3 480 352 480H64C28.65 480 0 451.3 0 416V128z"></path></svg>';
                      html += '</a>';
                  html += '</div>';
              html += '</div>';
          html += '</div>';
      }

      html +='</div>';
      
      $('#news-container').html(html);
    }
    
    
    if(flag == 0){

      var pagi = '';

      var currentPage = response.meta.page.currentPage;
      var from = response.meta.page.from;
      var lastPage = response.meta.page.lastPage;
      var perPage = response.meta.page.perPage;
      var to = response.meta.page.to;
      var $pages = response.meta.page.total;
      var $num_links = 3;

      var $start = ((currentPage - $num_links) > 0) ? (currentPage - ($num_links - 1)) : 1;
      var $end   = ((currentPage + $num_links) < lastPage) ? (currentPage + $num_links) : lastPage;
      
      if(getParameterByName('category') == null){
        if(getParameterByName('player') != null){
          var pg = '?player='+getParameterByName('player')+'&page=';
        }
        else if(getParameterByName('tags') != null){
          var pg = '?tags='+ getParameterByName('tags')+'&page=';;
        }else{
          var pg = '?page=';
        }
        
      }else{
        if(getParameterByName('tags') != null){
          var pg = '?category='+getParameterByName('category')+'&tags='+ getParameterByName('tags')+'&page=';
        }else{
          var pg = '?category='+getParameterByName('category')+'&page=';
        }
      }

      if($pages > 1){    

        if(currentPage > 1) {
          
          pagi += '<li>';
          pagi += '<a href="'+STOREFRONT_PREFIX+'/blogs/news'+pg+(currentPage-1)+'" class="pagination__item pagination__item--prev pagination__item-arrow link motion-reduce">';
          pagi += '<svg aria-hidden="true" focusable="false" role="presentation" class="icon icon-caret" viewBox="0 0 10 6"> <path fill-rule="evenodd" clip-rule="evenodd" d="M9.354.646a.5.5 0 00-.708 0L5 4.293 1.354.646a.5.5 0 00-.708.708l4 4a.5.5 0 00.708 0l4-4a.5.5 0 000-.708z" fill="currentColor"> </path> </svg>';
          pagi += '</a>';
          pagi += '</li>';
        }                 

        if(currentPage > 3) 
        {
          pagi += '<li><a href="'+STOREFRONT_PREFIX+'/blogs/news'+pg+'1" class="pagination__item link">1</a></li>';
          pagi += '<li><span class="pagination__item">...</span></li>';
        }
        for(var $x=$start ; $x<$end ;$x++)
        {

          pagi += '<li>';

          if($x == currentPage)
          {
            pagi += '<span class="pagination__item pagination__item--current" aria-current="page" >'+$x+'</span>';
          }
          else
          {
            pagi += '<a href="'+STOREFRONT_PREFIX+'/blogs/news'+pg+$x+'" class="pagination__item link">'+$x+'</a>';
          }
          pagi += '</li>';

        }
        if(currentPage < lastPage){
          pagi += '<li><span class="pagination__item">...</span></li>';
          pagi += '<li><a href="'+STOREFRONT_PREFIX+'/blogs/news'+pg+lastPage+'" class="pagination__item link">'+lastPage+'</a></li>';

        }

        if(currentPage < lastPage )
        {
          pagi += '<li>';
          pagi += '<a href="'+STOREFRONT_PREFIX+'/blogs/news'+pg+(parseInt(currentPage)+1)+'" class="pagination__item pagination__item--next pagination__item-arrow link motion-reduce">';
          pagi += '<svg aria-hidden="true" focusable="false" role="presentation" class="icon icon-caret" viewBox="0 0 10 6"> <path fill-rule="evenodd" clip-rule="evenodd" d="M9.354.646a.5.5 0 00-.708 0L5 4.293 1.354.646a.5.5 0 00-.708.708l4 4a.5.5 0 00.708 0l4-4a.5.5 0 000-.708z" fill="currentColor"> </path> </svg>';
          pagi += '</a>';
          pagi += '</li>';
        }

      }

      $('#news-pagination .pagination__list').html(pagi);
    }
  });
  
  slickCarousel();
  function slickCarousel() {
    $('.slider-for').slick({
      slidesToShow: 1,
      slidesToScroll: 1,
      infinite: false,
      arrows: true,
      asNavFor: '.slider-nav',
      adaptiveHeight: true
    });
    $('.slider-nav').slick({
      slidesToShow: slidetoshow,
      slidesToScroll: 1,
      asNavFor: '.slider-for',
      centerMode: true,
      focusOnSelect: true,
      infinite: false,
      responsive: [
        {
            breakpoint: 767,
            settings: {
              slidesToShow: 7,
            }
        },
        {
            breakpoint: 540,
            settings: {
              slidesToShow: 5,
            }
        }
      ]
    });

    $('.slick-aufstellung').slick({
      infinite: false,
      slidesToShow: 1,
      slidesToScroll: 1,
      dots: false,
      prevArrow:'<button type="button" data-role="none" class="slick-prev slick-arrow" aria-label="Prev" role="button"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" class="left"><path d="M4.409 11l9.061-9.061 2.121 2.121-6.939 6.939 6.939 6.939-2.121 2.121z" fill="#fff"></path></svg><span>Ersatzbank</span></button>',
      nextArrow:'<button type="button" data-role="none" class="slick-next slick-arrow" aria-label="Next" role="button"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" class="right"><path d="M8.53 20.061l-2.121-2.121 6.939-6.939-6.939-6.939 2.121-2.121 9.061 9.061z" fill="#fff"></path></svg><span>Ersatzbank</span></button>'
    });
    
    $('.slick-aufstellung').slick('slickGoTo', 1);

    $('.slick-aufstellung-mobile').slick({
      infinite: false,
      slidesToShow: 1,
      slidesToScroll: 1,
      dots: true,
      arrows: false
    });
  }
  function destroyCarousel() {
    if ($('.slider-for').hasClass('slick-initialized')) {
      $('.slider-for').slick('destroy');
    }
    if ($('.slider-nav').hasClass('slick-initialized')) {
      $('.slider-nav').slick('destroy');
    }

    if ($('.slick-aufstellung').hasClass('slick-initialized')) {
      $('.slick-aufstellung').slick('destroy');
    }

    if ($('.slick-aufstellung-mobile').hasClass('slick-initialized')) {
      $('.slick-aufstellung-mobile').slick('destroy');
    }
  }

  if(is_listpage == true){
  var settings = {
    "url": STOREFRONT_PREFIX + "/blogs/news/categories.js",
    "method": "GET",
    "timeout": 0,
    "headers": {
      "Authorization": Authorization,
      "Accept": "application/vnd.api+json"
    },
  };
  
  $.ajax(settings).done(function (response) {
  
    var totalData = response.data.length;
  
    var html='';
    
    for(var a=0 ; a < totalData ; a++){
      /*if(a == 0){
        var active = 'active';
      }
      else{
        var active = '';
      }*/

      if(response.data[a].attributes.translations[0].webName == 'Eisnull'){
        continue;
      }
      
      var active = '';
      if(getParameterByName('category') != null){
        var current_cat = getParameterByName('category');
      }else{
        var current_cat = '';
      }
      if(current_cat == response.data[a].attributes.translations[0].id){
        var active = 'active';
      }else{
        var active = '';
      }

      let categoryName = response.data[a].attributes.translations[0].webName || '';
      if(categoryName == ''){
        categoryName = response.data[a].attributes.translations[0].name;
      }
      
      if(response.data[a].attributes.isActive==1 && response.data[a].attributes.numberOfNews > 0){
        html += '<button class="btn '+active+'" data-id="'+categoryName+'" data-catid="'+response.data[a].attributes.translations[0].id+'" >'+categoryName+'</button>';
      }
    }
    if(current_cat == ''){
      var active = 'active';
    }else{
      var active = '';
    }
    html += '<button class="btn '+active+'" data-id="*">Alle Artikel</button>';
    $('#filter-container').html(html);
  });
}
});



//news filter

$(document).on('click','#filter-container .btn', function(){
  $(this).toggleClass('active');
  
  if($(this).hasClass('active')){
    var dataCat = $(this).data('catid');
    if(typeof dataCat !== 'undefined'){
        window.location.href=STOREFRONT_PREFIX+"/blogs/news?category="+dataCat;
    }else{
      window.location.href=STOREFRONT_PREFIX+"/blogs/news";
    }
  }else{
    window.location.href=STOREFRONT_PREFIX+"/blogs/news";
  }
  
  /*
  var dataID = $(this).data('id');
  
  $('.multicolumn-list .grid__item').addClass('hidden');
  $('#news-container .grid__item').addClass('hidden');
  
  $('#filter-container .btn.active').each(function(i){

    var dataID = $(this).data('id');
    
    $('.multicolumn-list .grid__item.'+dataID).removeClass('hidden');
    $('#news-container .grid__item.'+dataID).removeClass('hidden');
  });
  
  var activeFilter = $('#filter-container .btn.active').length;
  if(activeFilter == 0){
    
    $('.multicolumn-list .grid__item').removeClass('hidden');
    $('#news-container .grid__item').removeClass('hidden');
  }
  */
});
