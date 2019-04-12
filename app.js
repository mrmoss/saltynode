var bodyParser=require('body-parser');
var express=require('express');
var app=express();
var expressWs=require('express-ws')(app);
var settings=require('./settings');
var sqlite3=require('sqlite3');
var public_static='public_static';

function bad_cli(cli_str)
{
	console.log('Unknown command line option "'+cli_str+'"');
	process.exit(-1);
}
function ignore_cli(cli_str)
{
	console.log('Ignoring command line option "'+cli_str+'"');
}

for(var ii=2;ii<process.argv.length;++ii)
{
	var parts=process.argv[ii].split('=');
	if(parts.length!=2)
		bad_cli(process.argv[ii]);
	if(!parts[0].startsWith('--'))
	{
		ignore_cli(process.argv[ii]);
		continue;
	}
	parts[0]=parts[0].substring(2,parts[0].length);
	if(!(parts[0] in settings))
		bad_cli(process.argv[ii]);

	type=typeof(settings[parts[0]]);
	if(type=="number")
		parts[1]=parseInt(parts[1]);

	console.warn('Setting "'+parts[0]+'" to "'+parts[1]+'" with type "'+type+'"');
	settings[parts[0]]=parts[1];
}

var db=new sqlite3.Database('./saltybet.db');
app.listen(settings.listen_port,settings.listen_addr);
app.use(bodyParser.json({limit:settings.max_upload_size}));
app.use(express.static(public_static));
console.warn('listening on '+settings.listen_addr+':'+settings.listen_port);

function strip(str,ch)
{
	if(ch.length==0||ch.length>str.length)
		return str;
	while(str.length>0&&str.substr(0,ch.length)==ch)
		str=str.substr(ch.length,str.length-ch.length);
	while(ch.length>0&&str.substr(str.length-ch.length,ch.length)==ch)
		str=str.substr(0,str.length-ch.length);
	return str;
}

function get_match(cb)
{
	var query_str='select * from current';
	db.all(query_str,function(err,query)
	{
		if(query.length<=0)
			query={red:null,blue:null};
		else
			query=query[0];
		cb(query);
	});
}

function get_ranking(fighter,case_sensitive,cb)
{
	var query_str='select * from rankings where ';
	if(case_sensitive)
		query_str+='fighter=?';
	else
		query_str+='lower(fighter) like lower(?)';

	db.all(query_str,[fighter],function(err,query)
	{
		var existed=query.length>0;
		if(!existed)
			query={'id':null,'fighter':fighter,'wins':0,'losses':0,'fights':0,'win_ratio':0,'lose_ratio':0,existed:false};
		else
			query=query[0];
		query.existed=existed;
		cb(query);
	});
}

function get_rankings(fighter,case_sensitive,cb)
{
	var query_str='select * from rankings where ';
	if(case_sensitive)
		query_str+='fighter=?';
	else
		query_str+='lower(fighter) like lower(?)';

	db.all(query_str,[fighter],function(err,queries)
	{
		var rankings=[];
		queries.forEach(function(ranking)
		{
			ranking['existed']=true;
			rankings.push(ranking);
		});
		cb(rankings);
	});
}

function get_fights(winner,loser,case_sensitive,cb)
{
	var query_str='select * from fights where';
	var args=[];

	if(winner&&winner.length>0)
	{
		if(case_sensitive)
			query_str+=' winner=?';
		else
			query_str+=' lower(winner) like lower(?)';
		args.push(winner);
	}

	if(loser&&loser.length>0)
	{
		if(winner&&winner.length>0)
			query_str+=' and';
		if(case_sensitive)
			query_str+=' loser=?';
		else
			query_str+=' lower(loser) like lower(?)';
		args.push(loser)
	}

	if(args.length<1||args.length>2)
	{
		cb(null);
		return;
	}

	db.all(query_str,args,function(err,queries)
	{
		var fights=[];
		queries.forEach(function(fight)
		{
			fight['existed']=true;
			fights.push(fight);
		});
		cb(fights);
	});
}

function do_match(data,ret,res,cb)
{
	get_match(function(match)
		{
			ret.match=match;
			cb(data,ret,res);
		});
}

function do_rankings(data,ret,res,cb,ii,rankings,jj=0)
{
	if(jj>=rankings.length)
	{
		do_fighters(data,ret,res,cb,ii+1);
		return;
	}

	if(!rankings[jj].matches)
		rankings[jj].matches=[];

	get_fights(rankings[jj].fighter,null,true,function(fights)
	{
		for(var kk=0;kk<fights.length;++kk)
			rankings[jj].matches.push(fights[kk]);

		get_fights(null,rankings[jj].fighter,true,function(fights)
		{
			for(var kk=0;kk<fights.length;++kk)
				rankings[jj].matches.push(fights[kk]);

			ret.fighters.push(rankings[jj])
			do_rankings(data,ret,res,cb,ii,rankings,jj+1);
		});
	});
}

function do_fighters(data,ret,res,cb,ii=0)
{
	if(!ret.fighters)
		ret.fighters=[];

	if(ii>=data.fighters.length)
	{
		cb(data,ret,res);
		return;
	}

	var query=data.fighters[ii];
	query=strip(strip(query,'%'),'*');
	var exact=false;
	if(query.length==0)
	{
		do_fighters(data,ret,res,cb,ii+1);
		return;
	}
	if(query.length>1&&query[0]==query[query.length-1]&&(query[0]=='\''||query[0]=='"'))
	{
		exact=true;
		query=query.substr(1,query.length-2);
	}
	else if(query.length>=3)
		query='%'+query+'%';
	if(exact)
		get_ranking(query,true,function(ranking)
		{
			do_rankings(data,ret,res,cb,ii,[ranking]);
		});
	else
		get_rankings(query,false,function(rankings)
		{
			do_rankings(data,ret,res,cb,ii,rankings);
		});
}

function do_post(req,res)
{
	var ret={};
	var data=req.body;

	if(data.match)
		do_match(data,ret,res,function(data,ret,res)
		{
			if(data.fighters)
				do_fighters(data,ret,res,function(data,ret,res)
				{
					res.send(ret);
				});
			else
				res.send(ret);
		});
	else if(data.fighters)
		do_fighters(data,ret,res,function(data,ret,res)
		{
			res.send(ret);
		});
	else
		res.send(ret);

}

app.post('/',do_post);
app.post('/live/',do_post);
app.post('/search/',do_post);
